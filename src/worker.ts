import { POST as chatPost } from './chat.ts';
import { handleSessionApi } from './session-api.ts';
import { authRequired, loginWithPassword, verifyIdentity, sameOriginMutation,
  stripAndAuthorizeClientIdentity, verifiedJobAccess, withSession, logout, unauthorized } from './aai-auth.ts';

// AAi does not need a frontend framework: Cloudflare serves public/ as static assets.
// Only /api/* and the /login alias run through this Worker.
type WorkerBindings = Record<string, unknown> & {
  ASSETS: { fetch(request: Request): Promise<Response> };
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

type QueryValue = string | string[] | undefined;
type LegacyRequest = {
  method: string;
  headers: Record<string, string>;
  query: Record<string, QueryValue>;
  body: unknown;
  url: string;
  x_trace_id?: string;
  runtimeEnv?: { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string };
};
type LegacyResponse = {
  status(code: number): LegacyResponse;
  json(payload: unknown): LegacyResponse;
  setHeader(name: string, value: string): void;
  getHeader(name: string): string | undefined;
  readonly headersSent: boolean;
};
type LegacyHandler = (request: LegacyRequest, response: LegacyResponse) => Promise<unknown> | unknown;
type LegacyModule = { default: LegacyHandler };

const legacyModules: Record<string, () => Promise<LegacyModule>> = {
  '/api/file-jobs': () => import('../api_backup/file-jobs.js'),
  '/api/planning-memory': () => import('../api_backup/planning-memory.js'),
  '/api/friends/detect-and-suggest': () => import('../api_backup/friends/detect-and-suggest.js'),
  '/api/friends/confirm-and-save': () => import('../api_backup/friends/confirm-and-save.js'),
  '/api/planning-memory/:id': () => import('../api_backup/planning-memory/[id].js'),
};

function jsonError(status: number, error: string): Response {
  return Response.json({ error }, { status, headers: { 'cache-control': 'no-store' } });
}

function getLegacyRoute(pathname: string): { key: string; id?: string } | null {
  const path = pathname.replace(/\/$/, '') || '/';
  if (legacyModules[path]) return { key: path };
  const planningMatch = /^\/api\/planning-memory\/([^/]+)$/.exec(path);
  if (planningMatch) return { key: '/api/planning-memory/:id', id: decodeURIComponent(planningMatch[1]) };
  return null;
}

function appendQuery(query: Record<string, QueryValue>, key: string, value: string): void {
  const existing = query[key];
  if (existing === undefined) query[key] = value;
  else if (Array.isArray(existing)) existing.push(value);
  else query[key] = [existing, value];
}

async function parseBody(request: Request): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') return {};
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    try { return await request.json(); } catch { return {}; }
  }
  if (type.includes('multipart/form-data') || type.includes('application/x-www-form-urlencoded')) {
    const result: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
    const form = await request.formData();
    for (const [key, value] of form.entries()) {
      const previous = result[key];
      if (previous === undefined) result[key] = value;
      else if (Array.isArray(previous)) previous.push(value);
      else result[key] = [previous, value];
    }
    return result;
  }
  return (await request.text()) || {};
}

async function runLegacy(request: Request, route: { key: string; id?: string }, env: WorkerBindings): Promise<Response> {
  const url = new URL(request.url);
  const query: Record<string, QueryValue> = {};
  for (const [key, value] of url.searchParams.entries()) appendQuery(query, key, value);
  if (route.id !== undefined) query.id = route.id;

  const incomingTrace = request.headers.get('x-trace-id');
  const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  if (incomingTrace) headers.set('x-trace-id', incomingTrace);

  const legacyRequest: LegacyRequest = {
    method: request.method,
    headers: Object.fromEntries(request.headers.entries()),
    query,
    body: await parseBody(request),
    url: request.url,
    x_trace_id: incomingTrace || undefined,
    runtimeEnv: { SUPABASE_URL: String(env.SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY: String(env.SUPABASE_SERVICE_ROLE_KEY) },
  };

  let statusCode = 200;
  let finished = false;
  let response: Response | null = null;
  const legacyResponse: LegacyResponse = {
    status(code) { statusCode = code; return this; },
    json(payload) {
      finished = true;
      response = new Response(JSON.stringify(payload), { status: statusCode, headers });
      return this;
    },
    setHeader(name, value) { headers.set(name, value); },
    getHeader(name) { return headers.get(name) || undefined; },
    get headersSent() { return finished; },
  };

  try {
    // Import on demand, so missing Supabase secrets never crash the Worker at boot.
    const module = await legacyModules[route.key]();
    await module.default(legacyRequest, legacyResponse);
    return response || new Response(null, { status: 204, headers });
  } catch (error) {
    console.error('[AAi Worker legacy route]', route.key, error);
    return jsonError(500, 'Permintaan gagal diproses. Periksa log Worker.');
  }
}

async function dispatchRequest(request: Request, env: WorkerBindings): Promise<Response> {
  const path = new URL(request.url).pathname;
    if (path === '/api/chat' || path === '/api/chat/') {
      if (request.method !== 'POST') return jsonError(405, 'Method not allowed');
      return chatPost(request, env);
    }

    if (path === '/api/login' || path === '/api/sessions' || path === '/api/messages' ||
        /^\/api\/sessions\/[^/]+\/?$/.test(path)) {
      return handleSessionApi(request, env);
    }

    if (path.startsWith('/api/')) {
      const route = getLegacyRoute(path);
      if (!route) return jsonError(404, 'Endpoint tidak ditemukan.');
      if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
        return jsonError(503, 'Konfigurasi Supabase belum tersedia di Cloudflare Worker.');
      }
      return runLegacy(request, route, env);
    }

    return env.ASSETS.fetch(request);
}

export default {
  async fetch(request: Request, env: WorkerBindings): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/status' && request.method === 'GET') {
      return Response.json({ ok: true, runtime: 'cloudflare-worker' }, {
        headers: { 'cache-control': 'no-store' },
      });
    }
    if (path === '/api/auth-config' && request.method === 'GET') {
      return Response.json({ required: authRequired(env) }, { headers: { 'cache-control': 'no-store' } });
    }

    // Legacy mode remains unchanged until accounts have been enrolled. Never
    // enable recall in this mode; the user_id is not yet cryptographically proven.
    if (!authRequired(env)) {
      if (path === '/api/logout') return logout();
      return dispatchRequest(request, { ...env, AAI_RECALL_SEARCH_ENABLED: 'false' });
    }

    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (!sameOriginMutation(request)) return jsonError(403, 'Permintaan lintas situs ditolak.');
    if (path === '/api/login') {
      if (request.method !== 'POST') return jsonError(405, 'Method not allowed');
      return loginWithPassword(request, env);
    }
    if (path === '/api/logout') {
      if (request.method !== 'POST') return jsonError(405, 'Method not allowed');
      return logout();
    }

    const identity = await verifyIdentity(request, env);
    if (!identity) return unauthorized();
    if (path === '/api/me' && request.method === 'GET') {
      const response = Response.json({ user: {
        id: identity.userId, username: identity.username, person_id: identity.personId,
      } }, { headers: { 'cache-control': 'private, no-store' } });
      return identity.session ? withSession(response, identity.session) : response;
    }
    let authorized: Request;
    try {
      authorized = await stripAndAuthorizeClientIdentity(request, identity.userId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : '';
      return reason === 'IDOR'
        ? jsonError(403, 'Identitas akun tidak cocok dengan sesi login.')
        : jsonError(415, 'Permintaan harus menggunakan JSON.');
    }
    // Legacy file-job handlers used to trust arbitrary job_id. Check ownership
    // *before* importing any job processing or reading its contents.
    if (path.replace(/\/$/, '') === '/api/file-jobs' &&
        !(await verifiedJobAccess(authorized, env, identity.userId))) {
      return jsonError(404, 'Tugas file tidak ditemukan.');
    }
    const response = await dispatchRequest(authorized, env);
    return identity.session ? withSession(response, identity.session) : response;
  },
};
