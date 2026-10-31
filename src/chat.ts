import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
type RuntimeEnv = Record<string, unknown>;

const DEFAULT_PROVIDER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'qwen/qwen3.8-omni-flash';
const DEFAULT_TEST_MODEL = 'openai/gpt-oss-20b:free';
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
          title: string | null;
        };
        Insert: {
          id?: string;
          user_id: string;
          title?: string;
        };
        Update: {
          id?: string;
          user_id?: string;
          title?: string;
          updated_at?: string;
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
  parentId: string | null;
  editMessageId: string | null;
  updateOnly: boolean;
  personaName: string;
  modelPreference: 'main' | 'oss-test';
}

type ParsedRouteRequest = ParsedLoadSessionRequest | ParsedChatRequest;

interface ProviderMessage {
  role: 'system' | 'user' | 'assistant';
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
  env: RuntimeEnv;
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

function getTraceId(request: Request): string {
  const incomingTraceId = request.headers.get('x-trace-id');
  return incomingTraceId?.trim() || randomUUID();
}

function readEnv(name: string, env: RuntimeEnv): string | null {
  const value = env[name];
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
  const parentId = readTrimmedString(parsedValue.parent_id);
  const editMessageId = readTrimmedString(parsedValue.edit_message_id);
  const updateOnly = parsedValue.update_only === true;
  const personaName = readTrimmedString(parsedValue.persona_name) || DEFAULT_PERSONA;
  const modelPreference = readTrimmedString(parsedValue.model_preference) === 'oss-test' ? 'oss-test' : 'main';

  return {
    ok: true,
    value: {
      kind: 'chat',
      message,
      sessionId,
      userId,
      userMessageId,
      parentId,
      editMessageId,
      updateOnly,
      personaName,
      modelPreference,
    },
  };
}

function buildProviderMessages(message: string, personaName: string, history: ProviderMessage[]): ProviderMessage[] {
  const messages: ProviderMessage[] = [];

  if (personaName !== DEFAULT_PERSONA) {
    messages.push({
      role: 'system',
      content: `Respond while staying consistent with the persona "${personaName}".`,
    });
  }

  messages.push(...history);
  messages.push({ role: 'user', content: message });
  return messages;
}

function buildProviderPayload(
  message: string, personaName: string, model: string, traceId: string, history: ProviderMessage[],
): ProviderRequestBody {
  return {
    model,
    stream: true,
    messages: buildProviderMessages(message, personaName, history),
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
): Response {
  const response = Response.json({
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

function createSupabaseAdminClient(env: RuntimeEnv): SupabaseClient<Database> | null {
  const supabaseUrl = readEnv('SUPABASE_URL', env);
  const supabaseServiceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY', env);
  if (supabaseUrl === null || supabaseServiceRoleKey === null) {
    return null;
  }

  return createClient<Database>(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isUuidLike(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function handleLoadSession(sessionId: string, userId: string, traceId: string, env: RuntimeEnv): Promise<Response> {
  if (!isUuidLike(sessionId) || !isUuidLike(userId)) {
    return createJsonError(400, 'Identitas sesi tidak valid.', traceId);
  }

  const supabase = createSupabaseAdminClient(env);
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
    return createJsonError(404, 'Sesi tidak ditemukan.', traceId);
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

type PreparedSession = {
  supabase: SupabaseClient<Database>;
  sessionId: string;
  userMessageId: string;
  message: string;
  history: ProviderMessage[];
};
type PreparationResult = { ok: true; value: PreparedSession } | { ok: false; response: Response };

function preparationError(status: number, message: string, traceId: string): PreparationResult {
  return { ok: false, response: createJsonError(status, message, traceId) };
}

type HistoryRow = {
  id: string;
  role: string;
  content: string;
  parent_id: string | null;
};

// Follow the chosen message branch, not unrelated sibling versions. Only a
// small window is sent to the model to limit disclosure and input-token cost.
export function buildSessionContext(rows: HistoryRow[], parentId: string | null): ProviderMessage[] {
  const byId = new Map(rows.map(row => [row.id, row]));
  const path: ProviderMessage[] = [];
  const visited = new Set<string>();
  let id = parentId;
  while (id && path.length < 16 && !visited.has(id)) {
    visited.add(id);
    const row = byId.get(id);
    if (!row) break;
    if (row.role === 'user' || row.role === 'assistant') {
      path.unshift({ role: row.role, content: row.content.slice(0, 2400) });
    }
    id = row.parent_id;
  }
  return path;
}

async function checkSessionOwner(
  supabase: SupabaseClient<Database>, sessionId: string, userId: string,
): Promise<boolean> {
  const { data, error } = await supabase.from('sessions')
    .select('id').eq('id', sessionId).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

async function updateUserMessage(
  input: ParsedChatRequest, env: RuntimeEnv, traceId: string,
): Promise<Response> {
  if (!input.userId || !isUuidLike(input.userId) ||
      !input.sessionId || !isUuidLike(input.sessionId) ||
      !input.editMessageId || !isUuidLike(input.editMessageId)) {
    return createJsonError(400, 'Identitas sesi atau pesan tidak valid.', traceId);
  }
  const supabase = createSupabaseAdminClient(env);
  if (!supabase) return createJsonError(503, 'Konfigurasi Supabase belum lengkap.', traceId);
  if (!await checkSessionOwner(supabase, input.sessionId, input.userId)) {
    return createJsonError(404, 'Sesi tidak ditemukan.', traceId);
  }
  const { data, error } = await supabase.from('messages')
    .update({ content: input.message }).eq('id', input.editMessageId)
    .eq('session_id', input.sessionId).eq('role', 'user').select('id').maybeSingle();
  if (error) throw error;
  if (!data) return createJsonError(404, 'Pesan tidak ditemukan.', traceId);
  return Response.json({ success: true, message_id: data.id }, {
    headers: { 'cache-control': 'no-store', 'x-trace-id': traceId },
  });
}

async function prepareSession(
  input: ParsedChatRequest, env: RuntimeEnv, traceId: string,
): Promise<PreparationResult> {
  if (!input.userId || !isUuidLike(input.userId)) return preparationError(400, 'user_id tidak valid.', traceId);
  if (input.sessionId && !isUuidLike(input.sessionId)) return preparationError(400, 'session_id tidak valid.', traceId);
  if (input.userMessageId && !isUuidLike(input.userMessageId)) return preparationError(400, 'user_message_id tidak valid.', traceId);
  if (input.parentId && !isUuidLike(input.parentId)) return preparationError(400, 'parent_id tidak valid.', traceId);
  const supabase = createSupabaseAdminClient(env);
  if (!supabase) return preparationError(503, 'Konfigurasi Supabase belum lengkap.', traceId);

  let sessionId = input.sessionId;
  if (sessionId) {
    if (!await checkSessionOwner(supabase, sessionId, input.userId)) {
      return preparationError(404, 'Sesi tidak ditemukan.', traceId);
    }
  } else {
    const title = input.message.slice(0, 42).trim() || 'Obrolan baru';
    const { data, error } = await supabase.from('sessions')
      .insert({ user_id: input.userId, title }).select('id').single();
    if (error) throw error;
    sessionId = data.id;
  }

  const { data: recent, error: recentError } = await supabase.from('messages')
    .select('id, role, content, parent_id')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: false }).limit(80);
  if (recentError) throw recentError;

  let userMessageId: string;
  let contextParentId: string | null;
  let message = input.message;
  if (input.userMessageId) {
    const { data, error } = await supabase.from('messages')
      .select('id, parent_id, content').eq('id', input.userMessageId)
      .eq('session_id', sessionId).eq('role', 'user').maybeSingle();
    if (error) throw error;
    if (!data) return preparationError(404, 'Pesan yang dicoba ulang tidak ditemukan.', traceId);
    userMessageId = data.id;
    contextParentId = data.parent_id;
    message = data.content;
  } else {
    let parentId = input.parentId;
    if (!parentId) {
      parentId = recent?.[0]?.id ?? null;
    } else {
      const { data: parent, error } = await supabase.from('messages')
        .select('id').eq('id', parentId).eq('session_id', sessionId).maybeSingle();
      if (error) throw error;
      if (!parent) return preparationError(400, 'Induk pesan tidak termasuk sesi ini.', traceId);
    }
    const { data, error } = await supabase.from('messages')
      .insert({ session_id: sessionId, role: 'user', content: input.message, parent_id: parentId })
      .select('id').single();
    if (error) throw error;
    userMessageId = data.id;
    contextParentId = parentId;
  }
  const history = buildSessionContext(recent ?? [], contextParentId);
  return { ok: true, value: { supabase, sessionId, userMessageId, message, history } };
}

function createStreamHeaders(traceId: string): Headers {
  const headers = new Headers();
  headers.set('content-type', 'text/event-stream; charset=utf-8');
  headers.set('cache-control', 'no-cache, no-transform');
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
      headers.set('HTTP-Referer', readEnv('OPENROUTER_HTTP_REFERER', options.env) || DEFAULT_REFERER);
      headers.set('X-Title', readEnv('OPENROUTER_X_TITLE', options.env) || DEFAULT_TITLE);
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

export async function POST(request: Request, env: RuntimeEnv): Promise<Response> {
  const traceId = getTraceId(request);
  try {
    const requestBody = parseRequestBody(await request.text());

    if (!requestBody.ok) {
      return createJsonError(400, requestBody.message, traceId);
    }

    if (requestBody.value.kind === 'load_session') {
      return await handleLoadSession(requestBody.value.sessionId, requestBody.value.userId, traceId, env);
    }

    if (requestBody.value.updateOnly) {
      return await updateUserMessage(requestBody.value, env, traceId);
    }

    const apiKey = readEnv('OPENROUTER_API_KEY', env);
    if (apiKey === null) {
      return createJsonError(500, 'OPENROUTER_API_KEY belum dikonfigurasi.', traceId);
    }

    // Persist the session and user message before sending the first SSE event.
    // A session ID must always correspond to a real Supabase row.
    const prepared = await prepareSession(requestBody.value, env, traceId);
    if (!prepared.ok) return prepared.response;
    const { supabase, sessionId, userMessageId, message, history } = prepared.value;
    const personaName = requestBody.value.personaName;
    // Model gratis hanya dipakai atas pilihan eksplisit dari antarmuka untuk uji coba.
    const modelName = requestBody.value.modelPreference === 'oss-test'
      ? DEFAULT_TEST_MODEL
      : (readEnv('OPENROUTER_MAIN_MODEL', env) || DEFAULT_MODEL);
    const providerUrl = readEnv('OPENROUTER_API_URL', env) || DEFAULT_PROVIDER_URL;
    const providerPayload = buildProviderPayload(message, personaName, modelName, traceId, history);
    const encoder = new TextEncoder();
    const upstreamAbortController = new AbortController();

    let streamCanceled = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        let streamClosed = false;
        let resolvedModelUsed = modelName;
        let emittedTokenCount = 0;
        const replyParts: string[] = [];

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
            env,
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
            replyParts.push(token);
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

          // Do not report "done" until the assistant answer is durable.
          const { data: saved, error: saveError } = await supabase.from('messages')
            .insert({
              session_id: sessionId,
              role: 'assistant',
              content: replyParts.join(''),
              parent_id: userMessageId,
            })
            .select('id').single();
          if (saveError) throw saveError;

          const { error: touchError } = await supabase.from('sessions')
            .update({ updated_at: new Date().toISOString() }).eq('id', sessionId);
          if (touchError) {
            // The answer is already stored; timestamp failure must not produce
            // a duplicate assistant reply when the client retries.
            console.warn('[AAi session timestamp]', touchError.message);
          }
          enqueueEvent({
            done: true,
            session_id: sessionId,
            message_id: saved.id,
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
