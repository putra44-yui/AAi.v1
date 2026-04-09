import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

const DEFAULT_PROVIDER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'qwen/qwen3.6-plus';
const DEFAULT_PERSONA = 'Auto';
const DEFAULT_REFERER = 'https://aai.family';
const DEFAULT_TITLE = 'AAi Keluarga';
const REQUEST_TIMEOUT_MS = 90_000;
const NETWORK_RETRY_LIMIT = 2;
const NETWORK_RETRY_DELAY_MS = 600;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

interface Database {
  public: {
    Tables: {
      sessions: {
        Row: {
          id: string;
          user_id: string;
        };
        Insert: {
          id?: string;
          user_id: string;
        };
        Update: {
          id?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          id: string;
          session_id: string;
          role: string;
          content: string;
          parent_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          role: string;
          content: string;
          parent_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          role?: string;
          content?: string;
          parent_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

interface LoadedSessionMessage {
  id: string;
  role: string;
  content: string;
  parent_id: string | null;
  created_at: string;
}

interface ParsedLoadSessionRequest {
  kind: 'load_session';
  sessionId: string;
  userId: string;
}

interface ParsedChatRequest {
  kind: 'chat';
  message: string;
  sessionId: string | null;
  userId: string | null;
  userMessageId: string | null;
  personaName: string;
}

type ParsedRouteRequest = ParsedLoadSessionRequest | ParsedChatRequest;

interface ProviderMessage {
  role: 'system' | 'user';
  content: string;
}

interface ProviderRequestBody {
  model: string;
  stream: true;
  messages: ProviderMessage[];
  temperature: number;
  user: string;
}

interface ProviderFetchOptions {
  apiKey: string;
  providerUrl: string;
  payload: ProviderRequestBody;
  traceId: string;
  abortSignal: AbortSignal;
}

interface ProviderFetchSuccess {
  ok: true;
  response: Response;
}

interface ProviderFetchFailure {
  ok: false;
  message: string;
}

type ProviderFetchResult = ProviderFetchSuccess | ProviderFetchFailure;

interface InitEvent {
  phase: 'init';
  session_id: string;
}

interface TokenEvent {
  token: string;
}

interface DoneEvent {
  done: true;
  session_id: string;
  message_id: string;
  user_message_id: string;
  persona_used: string;
  model_used: string;
}

interface ErrorEvent {
  error: string;
  session_id?: string;
  user_message_id?: string;
}

type StreamEvent = InitEvent | TokenEvent | DoneEvent | ErrorEvent;

interface ParseRequestSuccess {
  ok: true;
  value: ParsedRouteRequest;
}

interface ParseRequestFailure {
  ok: false;
  message: string;
}

type ParseRequestResult = ParseRequestSuccess | ParseRequestFailure;

function getTraceId(request: NextRequest): string {
  const incomingTraceId = request.headers.get('x-trace-id');
  return incomingTraceId?.trim() || randomUUID();
}

function readEnv(name: string): string | null {
  const value = process.env[name];
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseJsonValue(input: string): JsonValue | null {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function isJsonObject(value: JsonValue | null): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readTrimmedString(value: JsonValue | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function parseRequestBody(input: string): ParseRequestResult {
  if (input.trim().length === 0) {
    return { ok: false, message: 'Body request tidak boleh kosong.' };
  }

  const parsedValue = parseJsonValue(input);
  if (!isJsonObject(parsedValue)) {
    return { ok: false, message: 'Body JSON tidak valid.' };
  }

  const action = readTrimmedString(parsedValue.action);
  if (action === 'load_session') {
    const sessionId = readTrimmedString(parsedValue.session_id);
    if (sessionId === null) {
      return { ok: false, message: 'Field session_id wajib diisi untuk load_session.' };
    }

    const userId = readTrimmedString(parsedValue.user_id);
    if (userId === null) {
      return { ok: false, message: 'Field user_id wajib diisi untuk load_session.' };
    }

    return {
      ok: true,
      value: {
        kind: 'load_session',
        sessionId,
        userId,
      },
    };
  }

  const message = readTrimmedString(parsedValue.message);
  if (message === null) {
    return { ok: false, message: 'Field message wajib diisi.' };
  }

  const sessionId = readTrimmedString(parsedValue.session_id);
  const userId = readTrimmedString(parsedValue.user_id);
  const userMessageId = readTrimmedString(parsedValue.user_message_id);
  const personaName = readTrimmedString(parsedValue.persona_name) || DEFAULT_PERSONA;

  return {
    ok: true,
    value: {
      kind: 'chat',
      message,
      sessionId,
      userId,
      userMessageId,
      personaName,
    },
  };
}

function buildProviderMessages(message: string, personaName: string): ProviderMessage[] {
  const messages: ProviderMessage[] = [];

  if (personaName !== DEFAULT_PERSONA) {
    messages.push({
      role: 'system',
      content: `Respond while staying consistent with the persona "${personaName}".`,
    });
  }

  messages.push({ role: 'user', content: message });
  return messages;
}

function buildProviderPayload(message: string, personaName: string, model: string, traceId: string): ProviderRequestBody {
  return {
    model,
    stream: true,
    messages: buildProviderMessages(message, personaName),
    temperature: 0.7,
    user: traceId,
  };
}

function createJsonError(status: number, message: string, traceId: string): Response {
  const headers = new Headers();
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  headers.set('x-trace-id', traceId);

  return new Response(JSON.stringify({ error: message, trace_id: traceId }), {
    status,
    headers,
  });
}

function createLoadSessionResponse(
  sessionId: string,
  userId: string,
  messages: LoadedSessionMessage[],
  traceId: string,
): NextResponse {
  const response = NextResponse.json({
    session_id: sessionId,
    user_id: userId,
    status: 'active',
    messages,
  });

  response.headers.set('content-type', 'application/json; charset=utf-8');
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-trace-id', traceId);
  return response;
}

function createSupabaseAdminClient(): SupabaseClient<Database> | null {
  const supabaseUrl = readEnv('SUPABASE_URL');
  const supabaseServiceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
  if (supabaseUrl === null || supabaseServiceRoleKey === null) {
    return null;
  }

  return createClient<Database>(supabaseUrl, supabaseServiceRoleKey);
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function handleLoadSession(sessionId: string, userId: string, traceId: string): Promise<Response> {
  if (!isUuidLike(sessionId)) {
    return createLoadSessionResponse(sessionId, userId, [], traceId);
  }

  const supabase = createSupabaseAdminClient();
  if (supabase === null) {
    return createJsonError(500, 'Konfigurasi Supabase belum lengkap.', traceId);
  }

  const { data: sessionRow, error: sessionError } = await supabase
    .from('sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('user_id', userId)
    .maybeSingle();

  if (sessionError) {
    return createJsonError(500, sessionError.message, traceId);
  }

  if (sessionRow === null) {
    return createJsonError(403, 'Akses ditolak', traceId);
  }

  const { data: messageRows, error: messageError } = await supabase
    .from('messages')
    .select('id, role, content, parent_id, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });

  if (messageError) {
    return createJsonError(500, messageError.message, traceId);
  }

  const messages: LoadedSessionMessage[] = (messageRows ?? []).map((messageRow) => ({
    id: messageRow.id,
    role: messageRow.role,
    content: messageRow.content,
    parent_id: messageRow.parent_id,
    created_at: messageRow.created_at,
  }));

  return createLoadSessionResponse(sessionId, userId, messages, traceId);
}

function createStreamHeaders(traceId: string): Headers {
  const headers = new Headers();
  headers.set('content-type', 'text/event-stream; charset=utf-8');
  headers.set('cache-control', 'no-cache, no-transform');
  headers.set('connection', 'keep-alive');
  headers.set('x-trace-id', traceId);
  return headers;
}

function serializeEvent(event: StreamEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return 'Terjadi kesalahan saat memproses stream.';
}

async function fetchProviderStream(options: ProviderFetchOptions): Promise<ProviderFetchResult> {
  let lastNetworkError = 'Gagal terhubung ke provider.';

  for (let attempt = 0; attempt <= NETWORK_RETRY_LIMIT; attempt += 1) {
    if (options.abortSignal.aborted) {
      return { ok: false, message: 'Permintaan dibatalkan.' };
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);
    const abortFromClient = (): void => abortController.abort();

    options.abortSignal.addEventListener('abort', abortFromClient, { once: true });

    try {
      const headers = new Headers();
      headers.set('Authorization', `Bearer ${options.apiKey}`);
      headers.set('Content-Type', 'application/json');
      headers.set('Accept', 'text/event-stream');
      headers.set('HTTP-Referer', readEnv('OPENROUTER_HTTP_REFERER') || DEFAULT_REFERER);
      headers.set('X-Title', readEnv('OPENROUTER_X_TITLE') || DEFAULT_TITLE);
      headers.set('X-Trace-Id', options.traceId);

      const response = await fetch(options.providerUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(options.payload),
        signal: abortController.signal,
      });

      if (response.ok) {
        return { ok: true, response };
      }

      const providerMessage = (await response.text()).trim();

      return {
        ok: false,
        message: providerMessage || `Provider mengembalikan status ${response.status}.`,
      };
    } catch (error) {
      const isAbortError = error instanceof Error && error.name === 'AbortError';
      if (options.abortSignal.aborted) {
        return { ok: false, message: 'Permintaan dibatalkan.' };
      }

      if (isAbortError) {
        lastNetworkError = `Timeout setelah ${REQUEST_TIMEOUT_MS}ms.`;
      } else if (error instanceof Error && error.message.trim().length > 0) {
        lastNetworkError = error.message;
      }

      if (attempt === NETWORK_RETRY_LIMIT) {
        return { ok: false, message: lastNetworkError };
      }

      if (options.abortSignal.aborted) {
        return { ok: false, message: 'Permintaan dibatalkan.' };
      }

      await sleep(NETWORK_RETRY_DELAY_MS * (attempt + 1));
    } finally {
      clearTimeout(timeoutId);
      options.abortSignal.removeEventListener('abort', abortFromClient);
    }
  }

  return { ok: false, message: lastNetworkError };
}

function extractProviderError(payload: JsonObject): string | null {
  const errorValue = payload.error;
  const directMessage = readTrimmedString(errorValue);
  if (directMessage !== null) {
    return directMessage;
  }

  if (!isJsonObject(errorValue)) {
    return null;
  }

  return readTrimmedString(errorValue.message);
}

function extractProviderModel(payload: JsonObject): string | null {
  return readTrimmedString(payload.model);
}

function readRawString(value: JsonValue | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

function extractProviderToken(payload: JsonObject): string | null {
  const choicesValue = payload.choices;
  if (!Array.isArray(choicesValue) || choicesValue.length === 0) {
    return null;
  }

  const firstChoice = choicesValue[0];
  if (!isJsonObject(firstChoice)) {
    return null;
  }

  const deltaValue = firstChoice.delta;
  if (!isJsonObject(deltaValue)) {
    return null;
  }

  const content = readRawString(deltaValue.content);
  if (content === null || content.length === 0) {
    return null;
  }

  return content;
}

export async function POST(request: NextRequest): Promise<Response> {
  const traceId = getTraceId(request);
  try {
    const requestBody = parseRequestBody(await request.text());

    if (!requestBody.ok) {
      return createJsonError(400, requestBody.message, traceId);
    }

    if (requestBody.value.kind === 'load_session') {
      return handleLoadSession(requestBody.value.sessionId, requestBody.value.userId, traceId);
    }

    const apiKey = readEnv('OPENROUTER_API_KEY');
    if (apiKey === null) {
      return createJsonError(500, 'OPENROUTER_API_KEY belum dikonfigurasi.', traceId);
    }

    const sessionId = requestBody.value.sessionId || randomUUID();
    const userMessageId = requestBody.value.userMessageId || randomUUID();
    const personaName = requestBody.value.personaName;
    const modelName = readEnv('OPENROUTER_MAIN_MODEL') || DEFAULT_MODEL;
    const providerUrl = readEnv('OPENROUTER_API_URL') || DEFAULT_PROVIDER_URL;
    const providerPayload = buildProviderPayload(requestBody.value.message, personaName, modelName, traceId);
    const encoder = new TextEncoder();
    const upstreamAbortController = new AbortController();

    let streamCanceled = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let streamClosed = false;
        let resolvedModelUsed = modelName;
        let emittedTokenCount = 0;

        const enqueueEvent = (event: StreamEvent): void => {
          if (streamClosed || streamCanceled) {
            return;
          }

          controller.enqueue(encoder.encode(serializeEvent(event)));
        };

        const closeStream = (): void => {
          if (streamClosed || streamCanceled) {
            return;
          }

          streamClosed = true;
          controller.close();
        };

        const emitStreamError = (message: string): void => {
          enqueueEvent({
            error: message,
            session_id: sessionId,
            user_message_id: userMessageId,
          });
          closeStream();
        };

        try {
          enqueueEvent({ phase: 'init', session_id: sessionId });

          const fetchResult = await fetchProviderStream({
            apiKey,
            providerUrl,
            payload: providerPayload,
            traceId,
            abortSignal: upstreamAbortController.signal,
          });

          if (!fetchResult.ok) {
            if (!streamCanceled) {
              emitStreamError(fetchResult.message);
            }
            return;
          }

          const providerResponse = fetchResult.response;
          if (providerResponse.body === null) {
            emitStreamError('Provider tidak mengirim body stream.');
            return;
          }

          const reader = providerResponse.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          const processLine = (line: string): void => {
            const normalizedLine = line.trim();
            if (normalizedLine.length === 0 || !normalizedLine.startsWith('data:')) {
              return;
            }

            const data = normalizedLine.slice(5).trim();
            if (data === '[DONE]') {
              return;
            }

            const parsedValue = parseJsonValue(data);
            if (!isJsonObject(parsedValue)) {
              return;
            }

            const providerError = extractProviderError(parsedValue);
            if (providerError !== null) {
              throw new Error(providerError);
            }

            const streamedModel = extractProviderModel(parsedValue);
            if (streamedModel !== null) {
              resolvedModelUsed = streamedModel;
            }

            const token = extractProviderToken(parsedValue);
            if (token === null) {
              return;
            }

            emittedTokenCount += 1;
            enqueueEvent({ token });
          };

          while (true) {
            const readResult = await reader.read();
            if (readResult.done) {
              break;
            }

            buffer += decoder.decode(readResult.value, { stream: true });

            let newlineIndex = buffer.indexOf('\n');
            while (newlineIndex !== -1) {
              const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
              buffer = buffer.slice(newlineIndex + 1);
              processLine(line);
              newlineIndex = buffer.indexOf('\n');
            }
          }

          buffer += decoder.decode();
          if (buffer.trim().length > 0) {
            processLine(buffer.replace(/\r$/, ''));
          }

          if (emittedTokenCount === 0) {
            emitStreamError('Provider tidak mengirim token jawaban.');
            return;
          }

          enqueueEvent({
            done: true,
            session_id: sessionId,
            message_id: randomUUID(),
            user_message_id: userMessageId,
            persona_used: personaName,
            model_used: resolvedModelUsed,
          });
          closeStream();
        } catch (error) {
          if (streamCanceled) {
            return;
          }

          emitStreamError(normalizeErrorMessage(error));
        }
      },
      cancel() {
        streamCanceled = true;
        upstreamAbortController.abort();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: createStreamHeaders(traceId),
    });
  } catch (error) {
    return createJsonError(500, normalizeErrorMessage(error), traceId);
  }
}
