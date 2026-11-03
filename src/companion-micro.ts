/** AAi Companion micro-replies: a PRIVATE, feature-gated, cheap one-sentence tool.
 * Never pass the user's chat history, other app state, image or token to the model.
 */
import { createClient } from '@supabase/supabase-js';

type MicroEvent = 'normal' | 'head' | 'protect' | 'repeat';
type Env = Record<string, unknown> & {
  AAI_AUTH_REQUIRED?: string;
  AAI_COMPANION_MICRO_ENABLED?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MICRO_MODEL?: string;
  AAI_COMPANION_RATE_LIMITER?: { limit(args: { key: string }): Promise<{ success: boolean }> };
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED = new Set<MicroEvent>(['normal','head','protect','repeat']);
const SYSTEM = [
  'Kamu adalah AAi, maskot perempuan kristal yang hangat, pemalu secukupnya, lucu dan sopan.',
  'Tulis SATU kalimat reaksi sentuhan dalam bahasa Indonesia, maksimal 100 karakter.',
  'Reaksi kepala: malu dan melindungi/merapikan rambut. Sentuhan kurang sopan: menjaga batas dengan lembut.',
  'Jawaban variatif, tidak formal dan tidak menggurui. Jangan vulgar, erotis, agresif, atau flirty.',
  'Jangan menyebut nama pengguna, isi chat/memori, aplikasi lain, hasil pencarian, atau kemampuan melihat layar.',
  'Hanya kalimat reaksinya, tanpa markdown, penjelasan, tanda kutip atau daftar.',
].join('\n');

function json(status: number, value: unknown): Response {
  return Response.json(value, { status, headers: { 'cache-control':'private, no-store', 'vary':'Cookie' } });
}
export function microEnabled(env: Env): boolean {
  return env.AAI_AUTH_REQUIRED === 'true' && env.AAI_COMPANION_MICRO_ENABLED === 'true'
    && !!env.OPENROUTER_API_KEY && !!env.OPENROUTER_MICRO_MODEL
    && !!env.SUPABASE_URL && !!env.SUPABASE_SERVICE_ROLE_KEY;
}
export function validateMicroRequest(input: unknown): { event: MicroEvent; recent: string[] } | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const item = input as Record<string, unknown>;
  if (Object.keys(item).some(key => key !== 'event' && key !== 'recent')) return null;
  if (typeof item.event !== 'string' || !ALLOWED.has(item.event as MicroEvent)) return null;
  if (item.recent !== undefined &&
      (!Array.isArray(item.recent) || item.recent.length > 3 ||
        item.recent.some(v => typeof v !== 'string' || v.length > 110))) return null;
  return { event:item.event as MicroEvent, recent:Array.isArray(item.recent)
    ? item.recent.map(v => v.replace(/\s+/g,' ').trim().slice(0,110)).filter(Boolean) : [] };
}
export function sanitizeMicroReply(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let reply = input.replace(/[\r\n]+/g, ' ').replace(/^["'\s•*-]+|["'\s•*-]+$/g, '')
    .replace(/\s+/g, ' ').trim();
  if (!reply || reply.length > 120 || reply.length < 3 || /<[^>]*>|\b(?:http|https|www\.|password|token|memori|sesi lain|search_web)\b/i.test(reply)) return null;
  if (/\b(?:telanjang|seks|payudara|vagina|penis|bokep|mesum|erotis)\b/i.test(reply)) return null;
  // Block multi-sentence essays; one punctuation at the end is fine.
  if (/[.!?].+[.!?]/.test(reply)) return null;
  return reply;
}
function accessCookie(request: Request): string | null {
  const cookies = (request.headers.get('cookie') || '').split(';').map(v => v.trim());
  const found = cookies.find(v => v.startsWith('__Host-aai_access='));
  if (!found) return null;
  try { const value=decodeURIComponent(found.split('=').slice(1).join('=')); return value.length <= 8192 ? value : null; }
  catch { return null; }
}
export async function handleCompanionMicro(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') return json(405, {error:'Method not allowed'});
  if (!microEnabled(env)) return json(503, {error:'Reaksi dinamis belum tersedia.'});
  const origin=request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) return json(403, {error:'Origin tidak diizinkan.'});
  if (!(request.headers.get('content-type') || '').includes('application/json')) return json(415,{error:'Kirim JSON.'});
  const raw=await request.text();
  if (raw.length>1500) return json(413,{error:'Permintaan terlalu panjang.'});
  let input:unknown;
  try { input=JSON.parse(raw); } catch {return json(400,{error:'JSON tidak valid.'});}
  const parsed=validateMicroRequest(input);
  if (!parsed) return json(400,{error:'Data event tidak valid.'});
  const token=accessCookie(request);
  if (!token) return json(401,{error:'Login terverifikasi diperlukan.'});
  const supabase=createClient(env.SUPABASE_URL!,env.SUPABASE_SERVICE_ROLE_KEY!,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
  });
  const {data, error}=await supabase.auth.getUser(token);
  const owner=data.user?.app_metadata?.aai_user_id;
  if (error || !data.user || typeof owner !== 'string' || !UUID.test(owner)) {
    return json(401,{error:'Login terverifikasi diperlukan.'});
  }
  const {data:legacy,error:userError}=await supabase.from('users')
    .select('id').eq('id',owner).maybeSingle();
  if (userError || !legacy) return json(403,{error:'Akun AAi belum terhubung.'});
  const limiter=env.AAI_COMPANION_RATE_LIMITER;
  if (!limiter || typeof limiter.limit !== 'function') return json(503,{error:'Batas penggunaan belum dikonfigurasi.'});
  let allowed=false;
  try {allowed=(await limiter.limit({key:'micro:'+data.user.id})).success === true;} catch{allowed=false;}
  if (!allowed) return json(429,{error:'Batas reaksi tercapai. Coba lagi nanti.'});

  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),2800);
  try {
    const prompt='Event: '+parsed.event+'\nKalimat terakhir, jangan diulang:\n'
      +(parsed.recent.length ? parsed.recent.join(' | ') : '(tidak ada)')
      +'\nTulis balasan baru yang spontan dan sopan.';
    const response=await fetch('https://openrouter.ai/api/v1/chat/completions',{
      method:'POST',signal:controller.signal,
      headers:{
        'authorization':'Bearer '+env.OPENROUTER_API_KEY,
        'content-type':'application/json',
        'HTTP-Referer':'https://aai-v0.aai-agents-yuiputra44.workers.dev',
        'X-Title':'AAi Companion Micro',
      },
      body:JSON.stringify({
        model:env.OPENROUTER_MICRO_MODEL,
        stream:false,
        temperature:.85,
        max_tokens:55,
        reasoning:{effort:'none',exclude:true},
        messages:[{role:'system',content:SYSTEM},{role:'user',content:prompt}],
      }),
    });
    if (!response.ok) return json(502,{error:'Model cepat belum siap.'});
    const payload:unknown=await response.json();
    const completion=payload && typeof payload==='object' && 'choices' in payload
      ? (payload as {choices?:Array<{message?:{content?:unknown}}>} ).choices?.[0]?.message?.content
      : null;
    const reply=sanitizeMicroReply(completion);
    if (!reply) return json(502,{error:'Balasan tidak sesuai batas gaya.'});
    return json(200,{reply,model:'micro',persisted:false});
  } catch {
    return json(504,{error:'Reaksi AI lambat. Gunakan reaksi lokal.'});
  } finally {clearTimeout(timeout);}
}
