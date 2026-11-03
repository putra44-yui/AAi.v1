import { createClient } from '@supabase/supabase-js';

type Env = {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reply(status: number, data: unknown): Response {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

function client(env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isId(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value);
}

async function bodyObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = await request.json();
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * Compatibility API for the existing AAi client.
 *
 * NOTE: The current username-only login is not real authentication. All callers
 * can submit a user_id; these ownership checks prevent accidental cross-user
 * modification, but must be replaced with verified user identity before public
 * multi-user rollout.
 */
export async function handleSessionApi(request: Request, env: Env): Promise<Response> {
  const supabase = client(env);
  if (!supabase) return reply(503, { error: 'Konfigurasi Supabase belum tersedia.' });

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '');
  const body = request.method === 'GET' ? null : await bodyObject(request);

  try {
    if (path === '/api/login') {
      if (request.method !== 'POST') return reply(405, { error: 'Method not allowed' });
      const username = typeof body?.username === 'string' ? body.username.trim().toLowerCase() : '';
      if (!username) return reply(400, { error: 'Username tidak boleh kosong.' });
      const { data: user, error } = await supabase.from('users')
        .select('id, username, person_id').eq('username', username).maybeSingle();
      if (error) throw error;
      if (!user) return reply(401, { error: 'Username tidak ditemukan.' });

      let familyRole: string | null = null;
      let personName: string | null = null;
      if (user.person_id) {
        const { data: person, error: personError } = await supabase.from('persons')
          .select('name, role').eq('id', user.person_id).maybeSingle();
        if (personError) throw personError;
        familyRole = person?.role ?? null;
        personName = person?.name ?? null;
      }
      return reply(200, {
        user: { id: user.id, username: user.username, family_role: familyRole, person_name: personName },
      });
    }

    if (path === '/api/sessions' && request.method === 'GET') {
      const userId = url.searchParams.get('user_id');
      if (!isId(userId)) return reply(400, { error: 'user_id tidak valid.' });
      const { data, error } = await supabase.from('sessions')
        .select('id, title, updated_at, compact_checkpoint_at')
        .eq('user_id', userId).order('updated_at', { ascending: false });
      if (error) throw error;
      return reply(200, data ?? []);
    }

    if (path === '/api/messages' && request.method === 'GET') {
      const userId = url.searchParams.get('user_id');
      const sessionId = url.searchParams.get('session_id');
      if (!isId(userId) || !isId(sessionId)) return reply(400, { error: 'Identitas sesi tidak valid.' });
      const { data: owned, error: ownershipError } = await supabase.from('sessions')
        .select('id').eq('id', sessionId).eq('user_id', userId).maybeSingle();
      if (ownershipError) throw ownershipError;
      if (!owned) return reply(404, { error: 'Sesi tidak ditemukan.' });
      const { data, error } = await supabase.from('messages')
        .select('id, role, content, parent_id, created_at')
        .eq('session_id', sessionId).order('created_at', { ascending: true });
      if (error) throw error;
      return reply(200, { success: true, session_id: sessionId, messages: data ?? [] });
    }

    const match = /^\/api\/sessions\/([^/]+)$/.exec(path);
    if (match && (request.method === 'PUT' || request.method === 'DELETE')) {
      const sessionId = decodeURIComponent(match[1]);
      const userId = request.method === 'DELETE'
        ? url.searchParams.get('user_id')
        : body?.user_id;
      if (!isId(userId) || !isId(sessionId)) return reply(400, { error: 'Identitas sesi tidak valid.' });
      const { data: owned, error: ownershipError } = await supabase.from('sessions')
        .select('id').eq('id', sessionId).eq('user_id', userId).maybeSingle();
      if (ownershipError) throw ownershipError;
      if (!owned) return reply(404, { error: 'Sesi tidak ditemukan.' });

      if (request.method === 'PUT') {
        const title = typeof body?.title === 'string' ? body.title.trim() : '';
        if (!title || title.length > 120) return reply(400, { error: 'Judul harus berisi 1–120 karakter.' });
        const { data, error } = await supabase.from('sessions')
          .update({ title, updated_at: new Date().toISOString() })
          .eq('id', sessionId).eq('user_id', userId).select('id').maybeSingle();
        if (error) throw error;
        return data ? reply(200, { success: true }) : reply(404, { error: 'Sesi tidak ditemukan.' });
      }

      // The DB schema has ON DELETE CASCADE on messages.session_id.
      const { data, error } = await supabase.from('sessions')
        .delete().eq('id', sessionId).eq('user_id', userId).select('id').maybeSingle();
      if (error) throw error;
      return data ? reply(200, { success: true }) : reply(404, { error: 'Sesi tidak ditemukan.' });
    }

    return reply(405, { error: 'Method not allowed' });
  } catch (error) {
    console.error('[AAi session API]', error instanceof Error ? error.message : 'unknown error');
    return reply(500, { error: 'Gagal memproses data sesi.' });
  }
}
