import { NextRequest } from 'next/server';

type RouteParamValue = string | string[] | undefined;
type RouteParams = Record<string, RouteParamValue>;
type QueryValue = string | string[] | undefined;
type QueryParams = Record<string, QueryValue>;

type LegacyRequest = {
  method: string;
  headers: Record<string, string>;
  query: QueryParams;
  body: unknown;
  url: string;
  x_trace_id?: string;
};

type LegacyResponse = {
  status: (code: number) => LegacyResponse;
  json: (payload: unknown) => LegacyResponse;
  setHeader: (name: string, value: string) => void;
  getHeader: (name: string) => string | undefined;
  write: (chunk: string | Uint8Array) => void;
  end: (chunk?: string | Uint8Array) => void;
  readonly headersSent: boolean;
};

type LegacyHandler = (req: LegacyRequest, res: LegacyResponse) => Promise<unknown> | unknown;

type RouteContext = {
  params?: RouteParams | Promise<RouteParams>;
};

const JSON_CONTENT_TYPE = 'application/json; charset=utf-8';

function appendQueryValue(query: QueryParams, key: string, value: string): void {
  const existingValue = query[key];
  if (typeof existingValue === 'undefined') {
    query[key] = value;
    return;
  }

  if (Array.isArray(existingValue)) {
    query[key] = [...existingValue, value];
    return;
  }

  query[key] = [existingValue, value];
}

function buildQueryParams(url: URL, routeParams: RouteParams): QueryParams {
  const query: QueryParams = {};

  for (const [key, value] of url.searchParams.entries()) {
    appendQueryValue(query, key, value);
  }

  for (const [key, value] of Object.entries(routeParams)) {
    if (typeof value === 'undefined') {
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        appendQueryValue(query, key, item);
      }
      continue;
    }

    appendQueryValue(query, key, value);
  }

  return query;
}

function toHeaderObject(request: NextRequest): Record<string, string> {
  return Object.fromEntries(request.headers.entries());
}

function formDataToObject(formData: FormData): Record<string, FormDataEntryValue | FormDataEntryValue[]> {
  const result: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};

  for (const [key, value] of formData.entries()) {
    const existingValue = result[key];
    if (typeof existingValue === 'undefined') {
      result[key] = value;
      continue;
    }

    if (Array.isArray(existingValue)) {
      result[key] = [...existingValue, value];
      continue;
    }

    result[key] = [existingValue, value];
  }

  return result;
}

async function parseRequestBody(request: NextRequest): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') {
    return {};
  }

  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('application/json')) {
    try {
      return await request.json();
    } catch {
      return {};
    }
  }

  if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
    const formData = await request.formData();
    return formDataToObject(formData);
  }

  const text = await request.text();
  return text || {};
}

function toUint8Array(chunk: string | Uint8Array): Uint8Array {
  if (typeof chunk === 'string') {
    return new TextEncoder().encode(chunk);
  }

  return chunk;
}

function combineChunks(chunks: Uint8Array[]): ArrayBuffer | null {
  if (chunks.length === 0) {
    return null;
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return combined.buffer.slice(combined.byteOffset, combined.byteOffset + combined.byteLength);
}

async function resolveParams(context?: RouteContext): Promise<RouteParams> {
  if (!context?.params) {
    return {};
  }

  return await context.params;
}

export async function runLegacyRoute(
  request: NextRequest,
  handler: LegacyHandler,
  context?: RouteContext
): Promise<Response> {
  const routeParams = await resolveParams(context);
  const requestBody = await parseRequestBody(request);
  const url = new URL(request.url);
  const query = buildQueryParams(url, routeParams);
  const responseHeaders = new Headers();
  const incomingTraceId = request.headers.get('x-trace-id');

  if (incomingTraceId) {
    responseHeaders.set('x-trace-id', incomingTraceId);
  }

  return await new Promise<Response>((resolve) => {
    let statusCode = 200;
    let sentHeaders = false;
    let ended = false;
    let streaming = false;
    let resolved = false;
    let responseBody: BodyInit | null = null;
    const bufferedChunks: Uint8Array[] = [];
    let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
      }
    });

    const resolveResponse = (body: BodyInit | null): void => {
      if (resolved) {
        return;
      }

      resolved = true;
      resolve(new Response(body, {
        status: statusCode,
        headers: responseHeaders
      }));
    };

    const resolveStreamingResponse = (): void => {
      if (resolved) {
        return;
      }

      resolved = true;
      resolve(new Response(stream, {
        status: statusCode,
        headers: responseHeaders
      }));
    };

    const legacyRequest: LegacyRequest = {
      method: request.method,
      headers: toHeaderObject(request),
      query,
      body: requestBody,
      url: request.url,
      x_trace_id: incomingTraceId ?? undefined
    };

    const legacyResponse: LegacyResponse = {
      status(code: number) {
        statusCode = code;
        return legacyResponse;
      },
      json(payload: unknown) {
        if (!responseHeaders.has('content-type')) {
          responseHeaders.set('content-type', JSON_CONTENT_TYPE);
        }

        responseBody = JSON.stringify(payload);
        sentHeaders = true;
        ended = true;
        resolveResponse(responseBody);
        return legacyResponse;
      },
      setHeader(name: string, value: string) {
        responseHeaders.set(name, value);
      },
      getHeader(name: string) {
        return responseHeaders.get(name) ?? undefined;
      },
      write(chunk: string | Uint8Array) {
        const encodedChunk = toUint8Array(chunk);
        sentHeaders = true;
        streaming = true;
        bufferedChunks.push(encodedChunk);
        resolveStreamingResponse();
        streamController?.enqueue(encodedChunk);
      },
      end(chunk?: string | Uint8Array) {
        if (chunk) {
          legacyResponse.write(chunk);
        }

        ended = true;
        sentHeaders = true;

        if (streaming) {
          streamController?.close();
          resolveStreamingResponse();
          return;
        }

        if (responseBody === null) {
          responseBody = combineChunks(bufferedChunks);
        }

        resolveResponse(responseBody);
      },
      get headersSent() {
        return sentHeaders;
      }
    };

    void Promise.resolve(handler(legacyRequest, legacyResponse))
      .then(() => {
        if (ended) {
          return;
        }

        if (streaming) {
          streamController?.close();
          resolveStreamingResponse();
          return;
        }

        if (responseBody === null) {
          responseBody = combineChunks(bufferedChunks);
        }

        resolveResponse(responseBody);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'Unknown error';

        if (streaming) {
          streamController?.enqueue(toUint8Array(`data: ${JSON.stringify({ error: message })}\n\n`));
          streamController?.close();
          resolveStreamingResponse();
          return;
        }

        statusCode = statusCode >= 400 ? statusCode : 500;
        responseHeaders.set('content-type', JSON_CONTENT_TYPE);
        resolveResponse(JSON.stringify({ error: message }));
      });
  });
}

export function createLegacyRouteHandlers(handler: LegacyHandler) {
  const execute = (request: NextRequest, context?: RouteContext): Promise<Response> => runLegacyRoute(request, handler, context);

  return {
    GET: execute,
    POST: execute,
    PUT: execute,
    PATCH: execute,
    DELETE: execute,
    OPTIONS: execute,
    HEAD: execute
  };
}