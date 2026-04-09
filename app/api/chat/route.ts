import { NextRequest } from 'next/server';
import legacyHandler from '../../../api_backup/chat.js';
import { createLegacyRouteHandlers, runLegacyRoute } from '../_lib/legacy-route';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

type LoadSessionRequestBody = {
  action?: unknown;
  session_id?: unknown;
  user_id?: unknown;
};

const handlers = createLegacyRouteHandlers(legacyHandler);

function readTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

async function tryReadLoadSessionRequest(request: NextRequest): Promise<LoadSessionRequestBody | null> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return null;
  }

  try {
    const payload = await request.clone().json();
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return null;
    }

    return payload as LoadSessionRequestBody;
  } catch {
    return null;
  }
}

function buildLoadSessionRequest(
  request: NextRequest,
  sessionId: string | null,
  userId: string | null,
): NextRequest {
  const url = new URL(request.url);

  if (sessionId !== null) {
    url.searchParams.set('session_id', sessionId);
  }

  if (userId !== null) {
    url.searchParams.set('user_id', userId);
  }

  return new NextRequest(url, {
    method: 'GET',
    headers: request.headers,
  });
}

export const GET = handlers.GET;
export const PUT = handlers.PUT;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
export const OPTIONS = handlers.OPTIONS;
export const HEAD = handlers.HEAD;

export async function POST(request: NextRequest): Promise<Response> {
  const payload = await tryReadLoadSessionRequest(request);
  if (readTrimmedString(payload?.action) === 'load_session') {
    const loadRequest = buildLoadSessionRequest(
      request,
      readTrimmedString(payload?.session_id),
      readTrimmedString(payload?.user_id),
    );

    return runLegacyRoute(loadRequest, legacyHandler);
  }

  return handlers.POST(request);
}
