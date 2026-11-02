import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

// Verified identity, never body.user_id or editable user_metadata.
type AuthEnv = { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string; AAI_AUTH_REQUIRED?: string };
export type VerifiedIdentity = {
  userId: string;
  username: string;
  personId: string | null;
  session: Session | null;
};
const ACCESS_COOKIE = '__Host-aai_access';
const REFRESH_COOKIE = '__Host-aai_refresh';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function authRequired(env: AuthEnv): boolean {
  return env.AAI_AUTH_REQUIRED === 'true';
}

function authClient(env: AuthEnv): SupabaseClient | null {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

function cookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie') || '';
  const pair = header.split(';').map(part => part.trim()).find(part => part.startsWith(name + '='));
  if (!pair) return null;
  try { return decodeURIComponent(pair.slice(name.length + 1)); } catch { return null; }
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
}

function setCookies(headers: Headers, session: Session | null): void {
  const base = '; HttpOnly; Secure; SameSite=Strict; Path=/';
  if (!session) {
    headers.append('Set-Cookie', ACCESS_COOKIE + '=; Max-Age=0' + base);
    headers.append('Set-Cookie', REFRESH_COOKIE + '=; Max-Age=0' + base);
    return;
  }
  const lifetime = Math.max(60, Math.min(3600, Number(session.expires_in) || 3600));
  headers.append('Set-Cookie', ACCESS_COOKIE + '=' + encodeURIComponent(session.access_token)
    + '; Max-Age=' + lifetime + base);
  headers.append('Set-Cookie', REFRESH_COOKIE + '=' + encodeURIComponent(session.refresh_token)
    + '; Max-Age=2592000' + base);
}

export function withSession(response: Response, session: Session | null): Response {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'private, no-store');
  headers.set('vary', 'Cookie');
  setCookies(headers, session);
  return new Response(response.body, { status: response.status, headers });
}

export function sameOriginMutation(request: Request): boolean {
  if (request.method === 'GET' || request.method === 'HEAD' || request.method === 'OPTIONS') return true;
  const origin = request.headers.get('origin');
  if (!origin) return false; // No cookie-authenticated cross-origin forms or CSRF.
  try { return new URL(origin).origin === new URL(request.url).origin; } catch { return false; }
}

async function linkedIdentity(supabase: SupabaseClient, authUser: {
  app_metadata?: Record<string, unknown>;
}): Promise<Omit<VerifiedIdentity, 'session'> | null> {
  const legacyId = authUser.app_metadata?.aai_user_id;
  if (typeof legacyId !== 'string' || !UUID.test(legacyId)) return null;
  const { data, error } = await supabase.from('users')
    .select('id, username, person_id').eq('id', legacyId).maybeSingle();
  if (error || !data) return null;
  return {
    userId: data.id,
    username: data.username,
    personId: data.person_id || null,
  };
}

export async function loginWithPassword(request: Request, env: AuthEnv): Promise<Response> {
  if (!sameOriginMutation(request)) return json(403, { error: 'Asal permintaan tidak diizinkan.' });
  const supabase = authClient(env);
  if (!supabase) return json(503, { error: 'Autentikasi belum dikonfigurasi.' });
  let body: unknown;
  try { body = await request.json(); } catch { return json(400, { error: 'JSON tidak valid.' }); }
  const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';
  if (!email || !password || email.length > 250 || password.length > 500) {
    return json(400, { error: 'Email dan kata sandi wajib diisi.' });
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user || !data.session) {
    return json(401, { error: 'Email atau kata sandi tidak cocok.' });
  }
  const identity = await linkedIdentity(supabase, data.user);
  if (!identity) return json(403, { error: 'Akun Auth belum dihubungkan dengan akun AAi.' });
  return withSession(json(200, { user: {
    id: identity.userId, username: identity.username,
    person_id: identity.personId,
  } }), data.session);
}

export async function verifyIdentity(request: Request, env: AuthEnv): Promise<VerifiedIdentity | null> {
  const supabase = authClient(env);
  if (!supabase) return null;
  const token = cookie(request, ACCESS_COOKIE);
  let session: Session | null = null;
  let authUser = null;
  if (token) {
    const checked = await supabase.auth.getUser(token);
    if (!checked.error) authUser = checked.data.user;
  }
  if (!authUser) {
    const refreshToken = cookie(request, REFRESH_COOKIE);
    if (!refreshToken) return null;
    const refreshed = await supabase.auth.refreshSession({ refresh_token: refreshToken });
    if (refreshed.error || !refreshed.data.session || !refreshed.data.user) return null;
    authUser = refreshed.data.user;
    session = refreshed.data.session;
  }
  const identity = await linkedIdentity(supabase, authUser);
  return identity ? { ...identity, session } : null;
}

export function stripAndAuthorizeClientIdentity(request: Request, userId: string): Promise<Request> {
  const url = new URL(request.url);
  const claimed = url.searchParams.get('user_id');
  if (claimed && claimed !== userId) return Promise.reject(new Error('IDOR'));
  if (url.searchParams.has('user_id')) url.searchParams.set('user_id', userId);
  if (request.method === 'GET' || request.method === 'HEAD') {
    return Promise.resolve(new Request(url, request));
  }
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) return Promise.reject(new Error('JSON_REQUIRED'));
  return request.clone().json().then((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('JSON_REQUIRED');
    const body = raw as Record<string, unknown>;
    if (body.user_id !== undefined && body.user_id !== userId) throw new Error('IDOR');
    body.user_id = userId;
    const headers = new Headers(request.headers);
    return new Request(url, { method: request.method, headers, body: JSON.stringify(body), signal: request.signal });
  });
}

export async function verifiedJobAccess(request: Request, env: AuthEnv, userId: string): Promise<boolean> {
  const url = new URL(request.url);
  let jobId = url.searchParams.get('job_id');
  let sessionId = url.searchParams.get('session_id');
  if (request.method === 'POST') {
    try {
      const payload = await request.clone().json() as Record<string, unknown>;
      jobId = typeof payload.job_id === 'string' ? payload.job_id : null;
    } catch { return false; }
  }
  const supabase = authClient(env);
  if (!supabase) return false;
  if (jobId) {
    if (!UUID.test(jobId)) return false;
    const { data, error } = await supabase.from('file_generation_jobs')
      .select('id').eq('id', jobId).eq('user_id', userId).maybeSingle();
    return !error && !!data;
  }
  if (sessionId) {
    if (!UUID.test(sessionId)) return false;
    const { data, error } = await supabase.from('sessions')
      .select('id').eq('id', sessionId).eq('user_id', userId).maybeSingle();
    return !error && !!data;
  }
  return false;
}

export function logout(): Response {
  return withSession(json(200, { success: true }), null);
}

export function unauthorized(): Response {
  return json(401, { error: 'Sesi tidak valid. Silakan masuk kembali.' });
}
