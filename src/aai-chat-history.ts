import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NativeToolCall } from './aai-tools.ts';
import { isSessionRecallRequest } from './aai-session-recall.ts';

/**
 * Private, model-callable search over at most ten recent conversations.
 * The model supplies only a topic. Identity and limits come from the server.
 * This module must remain disabled until Supabase Auth enrollment is complete.
 */
export const SEARCH_CHAT_HISTORY_TOOL = {
  type: 'function',
  function: {
    name: 'search_chat_history',
    description: 'Cari bukti topik dalam obrolan pengguna ini dari sesi lain milik akun yang sama. Gunakan ketika pengguna meminta mengingat percakapan sebelumnya yang tidak tampak dalam sesi aktif. Jangan gunakan untuk mencari web, memori keluarga orang lain, atau tugas biasa. Masukkan kata kunci subjek, bukan nama/ID akun.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Kata kunci topik obrolan yang hendak diingat (3–160 karakter), contoh: Ronaldo Messi PSG' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
} as const;

type RuntimeEnv = {
  SUPABASE_URL?: unknown;
  SUPABASE_SERVICE_ROLE_KEY?: unknown;
  AAI_AUTH_REQUIRED?: unknown;
  AAI_CROSS_SESSION_RECALL_ENABLED?: unknown;
};

export type HistoryExcerpt = {
  sessionTitle: string;
  role: 'user' | 'assistant';
  text: string;
  date: string | null;
};
export type HistorySearchResult = {
  ok: boolean;
  searchedSessions: number;
  found: number;
  excerpts: HistoryExcerpt[];
  error?: string;
};

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const HISTORY_MAX_SESSIONS = 10;
export const HISTORY_MAX_EXCERPTS = 4;
const WORD_STOP = new Set([
  'kita', 'aku', 'kamu', 'saya', 'kau', 'yang', 'itu', 'ini', 'tadi', 'kemarin',
  'sebelumnya', 'pernah', 'ingat', 'mengingat', 'inget', 'ingatan', 'bahas',
  'membahas', 'bicara', 'ngobrol', 'obrolan', 'diskusi', 'tentang', 'soal',
  'dulu', 'lagi', 'sudah', 'belum', 'coba', 'tolong', 'cari', 'riwayat',
  'cerita', 'dengan', 'dari', 'untuk', 'mana', 'siapa', 'kapan', 'apakah',
  'bagaimana', 'berikutnya', 'lanjutkan', 'sekarang', 'perbincangan',
  'chat', 'sesi', 'lain', 'lebih', 'dalam', 'cek',
]);

export function isHistoryRecallIntent(message: string): boolean {
  if (/^\s*(?:tolong\s+)?(?:ingat\s+(?:ini|bahwa|kalau)|catat|simpan)\b/i.test(message)) return false;
  return isSessionRecallRequest(message)
    || /\b(?:cari|cek|telusuri|lihat)\s+(?:di\s+)?(?:riwayat|chat|percakapan|sesi)\b/i.test(message)
    || /\b(?:kita\s+)?(?:bahas|bicara|ngobrol)\s+(?:di\s+)?sesi\s+lain\b/i.test(message);
}

export function historyToolEnabled(env: RuntimeEnv): boolean {
  return env.AAI_AUTH_REQUIRED === 'true' && env.AAI_CROSS_SESSION_RECALL_ENABLED === 'true'
    && typeof env.SUPABASE_URL === 'string' && !!env.SUPABASE_URL
    && typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string' && !!env.SUPABASE_SERVICE_ROLE_KEY;
}

function cookie(request: Request, key: string): string | null {
  const header = request.headers.get('cookie') || '';
  const part = header.split(';').map(x => x.trim()).find(x => x.startsWith(key + '='));
  if (!part) return null;
  try { return decodeURIComponent(part.slice(key.length + 1)); } catch { return null; }
}

export async function verifiedHistoryOwner(
  request: Request, env: RuntimeEnv, claimedUserId: string,
): Promise<string | null> {
  if (!historyToolEnabled(env) || !UUID.test(claimedUserId)) return null;
  // Do not permit cross-site cookie replay or browser-controlled IDs.
  const origin = request.headers.get('origin');
  if (!origin) return null;
  try { if (new URL(origin).origin !== new URL(request.url).origin) return null; } catch { return null; }
  const token = cookie(request, '__Host-aai_access');
  if (!token || token.length > 8192) return null;
  const auth = createClient(String(env.SUPABASE_URL), String(env.SUPABASE_SERVICE_ROLE_KEY), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) return null;
  // app_metadata is administrator-controlled, unlike user_metadata.
  const linkedId = data.user.app_metadata?.aai_user_id;
  return linkedId === claimedUserId ? linkedId : null;
}

export function parseHistoryToolQuery(call: NativeToolCall): string | null {
  if (call.type !== 'function' || call.function.name !== 'search_chat_history') return null;
  try {
    const obj: unknown = JSON.parse(call.function.arguments);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    const input = obj as Record<string, unknown>;
    if (Object.keys(input).some(key => key !== 'query')) return null;
    if (typeof input.query !== 'string') return null;
    const q = input.query.replace(/\s+/g, ' ').trim();
    return q.length >= 3 && q.length <= 160 ? q : null;
  } catch { return null; }
}

function terms(query: string): string[] {
  return [...new Set((query.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])
    .filter(w => !WORD_STOP.has(w)))].slice(0, 8);
}

export async function searchChatHistory(
  supabase: SupabaseClient, verifiedUserId: string, query: string,
  activeSessionId: string | null = null,
): Promise<HistorySearchResult> {
  if (!UUID.test(verifiedUserId)) return { ok:false, searchedSessions:0, found:0, excerpts:[], error:'Identitas belum terverifikasi.' };
  const keywords = terms(query);
  if (!keywords.length) return { ok:true, searchedSessions:0, found:0, excerpts:[] };
  // Authorization happens in the first query; the second one only references
  // session IDs proven to belong to this user. Never query messages globally.
  let sessionQuery = supabase.from('sessions')
    .select('id,title,updated_at')
    .eq('user_id', verifiedUserId)
    .order('updated_at', { ascending:false })
    .limit(HISTORY_MAX_SESSIONS);
  if (activeSessionId && UUID.test(activeSessionId)) sessionQuery = sessionQuery.neq('id', activeSessionId);
  const { data: sessions, error: sessionError } = await sessionQuery;
  if (sessionError) return { ok:false, searchedSessions:0, found:0, excerpts:[], error:'Gagal membuka daftar sesi.' };
  const owned = (sessions || []).filter(item => typeof item.id === 'string' && UUID.test(item.id))
    .slice(0, HISTORY_MAX_SESSIONS);
  if (!owned.length) return { ok:true, searchedSessions:0, found:0, excerpts:[] };
  const ids = owned.map(s => s.id);
  const { data: messages, error: messageError } = await supabase.from('messages')
    .select('session_id,role,content,created_at')
    .in('session_id', ids)
    .in('role', ['user','assistant'])
    .order('created_at', { ascending:false })
    .limit(300);
  if (messageError) return { ok:false, searchedSessions:owned.length, found:0, excerpts:[], error:'Gagal membaca pesan.' };
  const owners = new Map(owned.map(item => [item.id, item]));
  const matches = (messages || []).map((msg, idx) => {
    const owner = owners.get(msg.session_id);
    if (!owner || typeof msg.content !== 'string') return null;
    const lower = msg.content.normalize('NFKC').toLowerCase();
    const hits = keywords.filter(term => lower.includes(term)).length;
    if (!hits) return null;
    return { msg, owner, idx, score:hits * 20 + (msg.role === 'user' ? 3 : 0) };
  }).filter((v): v is NonNullable<typeof v> => v !== null)
    .sort((a,b) => b.score - a.score || a.idx - b.idx)
    .slice(0,HISTORY_MAX_EXCERPTS);
  return {
    ok:true, searchedSessions:owned.length, found:matches.length,
    excerpts: matches.map(({msg,owner}) => ({
      sessionTitle:String(owner.title || 'Percakapan').slice(0,65),
      role:msg.role === 'user' ? 'user' : 'assistant',
      text:msg.content.replace(/\[📷 Lampiran gambar:[^\]]*\]/g,'[lampiran tidak tersedia]')
        .replace(/\s+/g,' ').slice(0,420),
      date:typeof msg.created_at === 'string' ? msg.created_at : null,
    })),
  };
}

export function historyResultForModel(result: HistorySearchResult): string {
  return JSON.stringify(result);
}
