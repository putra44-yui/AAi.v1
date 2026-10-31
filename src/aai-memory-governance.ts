import type { SupabaseClient } from '@supabase/supabase-js';
import { extractAAiMemoryTags, readableAAiMemoryValue } from './aai-context';
import { saveMemoryWithLockGuard } from '../lib/lock-guard';

type Candidate = { key: string; value: string; memoryType: string; category: string };
type ExistingMemory = {
  id: string; key: string | null; value: string | null; memory_scope: string | null;
  memory_type: string | null; observation_count: number | null; confidence: number | null;
};
type MemoryResult = { written: number; forgotten: number; evidence: number; conflicts: number };

const STABLE_KEYS = new Set([
  'nama_panggilan', 'nama_lengkap', 'tanggal_lahir', 'tempat_lahir', 'domisili',
  'profil_mbti', 'pola_pikir_inti', 'prinsip_keputusan', 'nilai_hidup', 'role_keluarga',
  'warisan_pola_pikir',
]);
const CANONICAL: Record<string, string> = {
  nama: 'nama_panggilan', nama_panggil: 'nama_panggilan', nickname: 'nama_panggilan',
  nick_name: 'nama_panggilan', full_name: 'nama_lengkap', fullname: 'nama_lengkap',
  nama_lengkap_user: 'nama_lengkap', tgl_lahir: 'tanggal_lahir',
  lahir: 'tanggal_lahir', birth_date: 'tanggal_lahir', birthday: 'tanggal_lahir',
  birth_place: 'tempat_lahir', kota_tinggal: 'domisili', alamat: 'domisili',
  mbti: 'profil_mbti', tipe_kepribadian: 'profil_mbti', personality_type: 'profil_mbti',
  pola_pikir: 'pola_pikir_inti', mindset: 'pola_pikir_inti',
  kerangka_berpikir: 'pola_pikir_inti', cara_pikir_inti: 'pola_pikir_inti',
  thought_framework: 'pola_pikir_inti', gaya_berpikir: 'pola_pikir_inti',
  cognitive_style: 'pola_pikir_inti', prinsip_hidup: 'prinsip_keputusan',
  prinsip_ambil_keputusan: 'prinsip_keputusan', decision_rule: 'prinsip_keputusan',
  decision_rules: 'prinsip_keputusan', decision_framework: 'prinsip_keputusan',
  decision_principle: 'prinsip_keputusan', nilai_inti: 'nilai_hidup',
  nilai_utama: 'nilai_hidup', value_system: 'nilai_hidup',
  prinsip_nilai: 'nilai_hidup', core_values: 'nilai_hidup', values: 'nilai_hidup',
};
const STABLE_HINTS = ['pola_pikir', 'mindset', 'kerangka', 'prinsip', 'nilai', 'decision', 'value', 'warisan'];

export function canonicalMemoryKey(input: string): string {
  const key = String(input || '').trim().toLowerCase().normalize('NFKC')
    .replace(/[^a-z0-9_\s-]/g, '').replace(/\s+/g, '_').replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '').slice(0, 80);
  return CANONICAL[key] || key;
}
export function memoryScope(candidate: Candidate): 'stable' | 'dynamic' {
  if (candidate.memoryType === 'cara_berpikir' || STABLE_KEYS.has(candidate.key)) return 'stable';
  if (candidate.memoryType === 'pattern' && STABLE_HINTS.some(hint => candidate.key.includes(hint))) return 'stable';
  return 'dynamic';
}
function normalizedText(input: string): string {
  return String(input || '').toLowerCase().trim().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function similarity(a: string, b: string): number {
  const left = new Set(normalizedText(a).split(' ').filter(Boolean));
  const right = new Set(normalizedText(b).split(' ').filter(Boolean));
  if (!left.size || !right.size) return 0;
  return [...left].filter(word => right.has(word)).length / new Set([...left, ...right]).size;
}
function explicitCorrection(message: string): boolean {
  return /\b(koreksi|ralat|salah|sekarang|bukan lagi|sudah berubah|ubah|sebelumnya|dulunya|yang benar|yang betul|ganti menjadi)\b/i.test(message);
}
function evidenceAssessment(message: string, candidate: Candidate): {
  status: 'validated' | 'provisional'; reliability: number; emotion: string; emotionConfidence: number;
} {
  const doubt = /\b(mungkin|sepertinya|kayaknya|kurasa|belum pasti|barangkali)\b/i.test(message);
  const distress = /\b(sedih|cemas|panik|takut|marah|kesal|putus asa)\b/i.test(message);
  const scope = memoryScope(candidate);
  const emotion = distress ? 'cemas' : 'netral';
  const reliability = Number(Math.max(0.15, (candidate.memoryType === 'emosi' ? .84 : scope === 'stable' ? .66 : .72) - (doubt ? .24 : 0) - (distress && candidate.memoryType !== 'emosi' ? .2 : 0)).toFixed(4));
  return {
    status: doubt || (scope === 'stable' && distress) ? 'provisional' : 'validated',
    reliability, emotion, emotionConfidence: distress ? .75 : 0,
  };
}
async function sha1(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function claimHashes(candidate: Candidate, sessionId: string | null): Promise<{
  claimHash: string; contextHash: string;
}> {
  const scope = memoryScope(candidate);
  // Preserve Vercel's historic hash format so retries do not double-count old evidence.
  const claimHash = await sha1([candidate.memoryType, candidate.key,
    normalizedText(candidate.value), normalizedText(candidate.category)].join('|'));
  const bucket = sessionId ? 'session:' + sessionId : 'hour:' + new Date().toISOString().slice(0, 13);
  return { claimHash, contextHash: await sha1([bucket, claimHash, scope].join('|')) };
}
function supportedByUser(message: string, candidate: Candidate): boolean {
  if (!/\b(aku|saya|kami|diriku|istriku|suamiku|anakku|keluargaku|ingat|catat|namaku)\b/i.test(message)) return false;
  const userTerms = new Set(normalizedText(message).split(' ').filter(word => word.length >= 3));
  const valueTerms = normalizedText(candidate.value).split(' ').filter(word => word.length >= 3);
  const overlap = valueTerms.filter(word => userTerms.has(word)).length;
  if (overlap >= 2) return true;
  if (overlap === 1 && valueTerms.length <= 5) return true;
  return STABLE_KEYS.has(candidate.key) && /\b(ingat|catat|namaku|nama saya)\b/i.test(message);
}
function evidenceMetrics(count: number, scope: string): {
  observation_count: number; confidence: number; priority_score: number;
} {
  const n = Math.max(1, count);
  const confidence = Number(Math.min(.96, (scope === 'stable' ? .58 : .68) + (n - 1) * (scope === 'stable' ? .06 : .05)).toFixed(4));
  return { observation_count: n, confidence,
    priority_score: Number((confidence * Math.max(.3, Math.min(1, n / 5))).toFixed(4)) };
}
async function audit(supabase: SupabaseClient, data: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('legacy_audit_log').insert(data);
  if (error) console.warn('[AAi memory audit]', error.message);
}
async function validatedCount(supabase: SupabaseClient, memoryId: string): Promise<number> {
  const { count, error } = await supabase.from('person_memory_evidence').select('id', { count: 'exact', head: true })
    .eq('memory_id', memoryId).eq('evidence_status', 'validated');
  if (error) throw error;
  return count || 0;
}

export async function persistAAiMemory(
  supabase: SupabaseClient, personId: string | null, userId: string, userMessage: string,
  userMessageId: string, rawText: string, sessionId: string | null,
): Promise<MemoryResult> {
  const result: MemoryResult = { written: 0, forgotten: 0, evidence: 0, conflicts: 0 };
  if (!personId) return result;
  const tags = extractAAiMemoryTags(rawText);
  const hasForgetIntent = /\b(lupakan|hapus memori|jangan ingat|forget)\b/i.test(userMessage);
  if (hasForgetIntent) {
    for (const rawKey of tags.forgetKeys.slice(0, 3)) {
      const key = canonicalMemoryKey(rawKey);
      const { data, error } = await supabase.from('person_memory').update({
        status: 'dropped', deleted_at: new Date().toISOString(),
        deleted_by: userId, deletion_reason: 'Permintaan eksplisit pengguna',
        priority_score: 0.02,
      }).eq('person_id', personId).eq('key', key).eq('status', 'active').select('id');
      if (error) throw error;
      const affected = data?.length || 0;
      result.forgotten += affected;
      if (affected) await audit(supabase, {
        person_id: personId, session_id: sessionId, source_message_id: userMessageId,
        event_type: 'memory_dropped', reason_code: 'explicit_user_request',
        payload: { key, affected },
      });
    }
  }

  for (const original of tags.candidates.slice(0, 2)) {
    const candidate: Candidate = { ...original, key: canonicalMemoryKey(original.key) };
    if (!candidate.key || !supportedByUser(userMessage, candidate)) continue;
    const scope = memoryScope(candidate);
    const { data: previous, error: readError } = await supabase.from('person_memory')
      .select('id, key, value, memory_scope, memory_type, observation_count, confidence')
      .eq('person_id', personId).eq('key', candidate.key).eq('status', 'active')
      .order('updated_at', { ascending: false }).limit(1).maybeSingle();
    if (readError) throw readError;
    const existing = previous as ExistingMemory | null;
    if (!existing) {
      const { data: archived, error: archiveError } = await supabase.from('person_memory')
        .select('id').eq('person_id', personId).eq('key', candidate.key)
        .neq('status', 'active').limit(1);
      if (archiveError) throw archiveError;
      if (archived?.length) continue; // Never resurrect a forgotten fact automatically.
    }

    const { claimHash, contextHash } = await claimHashes(candidate, sessionId);
    const { data: duplicate, error: duplicateError } = await supabase.from('person_memory_evidence')
      .select('id').eq('person_id', personId).eq('unique_context_hash', contextHash)
      .limit(1).maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate) continue;

    const assessment = evidenceAssessment(userMessage, candidate);
    const oldValue = existing ? readableAAiMemoryValue(existing.value) : '';
    const equivalent = existing && (normalizedText(oldValue) === normalizedText(candidate.value)
      || similarity(oldValue, candidate.value) >= .86);
    const conflict = Boolean(existing && !equivalent && !explicitCorrection(userMessage));
    const status = conflict ? 'conflict' : assessment.status;
    const commonEvidence = {
      person_id: personId, memory_id: existing?.id || null,
      memory_key: candidate.key, memory_type: candidate.memoryType,
      memory_value: candidate.value, memory_scope: scope, category: candidate.category,
      source_message_id: userMessageId, source_session_id: sessionId,
      unique_context_hash: contextHash, normalized_claim_hash: claimHash,
      evidence_status: status, reliability_score: assessment.reliability,
      emotional_state: assessment.emotion, emotion_confidence: assessment.emotionConfidence,
      style_signals: [] as string[],
      context_window: normalizedText(userMessage).split(' ').slice(0, 42).join(' ').slice(0, 240),
    };
    if (status !== 'validated') {
      const { data: uncertain, error } = await supabase.from('person_memory_evidence')
        .insert(commonEvidence).select('id').single();
      if (error) throw error;
      result.evidence++;
      if (conflict) result.conflicts++;
      await audit(supabase, {
        person_id: personId, memory_id: existing?.id || null, evidence_id: uncertain.id,
        session_id: sessionId, source_message_id: userMessageId,
        event_type: conflict ? 'memory_conflict' : 'memory_provisional',
        reason_code: conflict ? 'unconfirmed_change' : 'uncertain_statement',
        payload: { key: candidate.key, old_value: oldValue || null, proposed_value: candidate.value },
      });
      continue;
    }

    // Preserve legacy lock semantics: a locked memory can only create a review draft.
    const guard = await saveMemoryWithLockGuard({
      supabase, userId, memoryKey: candidate.key, content: candidate.value,
      evidenceChain: [{ step: 'user_statement', confidence: assessment.reliability, source: userMessageId }],
    });
    if (guard.status !== 'saved') {
      await audit(supabase, {
        person_id: personId, memory_id: existing?.id || null,
        session_id: sessionId, source_message_id: userMessageId,
        event_type: 'memory_locked', reason_code: guard.status,
        payload: { key: candidate.key, draft_id: guard.draftId },
      });
      continue;
    }

    let memoryId: string;
    if (existing) {
      memoryId = existing.id;
      if (!equivalent) {
        const { error } = await supabase.from('person_memory').update({
          value: candidate.value, memory_type: candidate.memoryType, category: candidate.category,
          memory_scope: scope, source_message_id: userMessageId, updated_at: new Date().toISOString(),
        }).eq('id', existing.id).eq('person_id', personId).eq('status', 'active');
        if (error) throw error;
      }
    } else {
      const metrics = evidenceMetrics(1, scope);
      const { data: fresh, error } = await supabase.from('person_memory').insert({
        person_id: personId, key: candidate.key, value: candidate.value,
        memory_type: candidate.memoryType, category: candidate.category,
        source_message_id: userMessageId, memory_scope: scope, status: 'active',
        ...metrics,
      }).select('id').single();
      if (error) throw error;
      memoryId = fresh.id;
    }
    const { data: evidence, error: evidenceError } = await supabase.from('person_memory_evidence')
      .insert({ ...commonEvidence, memory_id: memoryId }).select('id').single();
    if (evidenceError) throw evidenceError;
    result.evidence++;
    const count = await validatedCount(supabase, memoryId);
    const metrics = evidenceMetrics(Math.max(count, Number(existing?.observation_count) || 1), scope);
    const { error: updateError } = await supabase.from('person_memory').update({
      ...metrics, updated_at: new Date().toISOString(),
    }).eq('id', memoryId).eq('person_id', personId).eq('status', 'active');
    if (updateError) throw updateError;
    result.written++;
    await audit(supabase, {
      person_id: personId, memory_id: memoryId, evidence_id: evidence.id,
      session_id: sessionId, source_message_id: userMessageId,
      event_type: !existing ? 'memory_created' : equivalent ? 'memory_reinforced' : 'memory_corrected',
      reason_code: 'validated_user_statement',
      payload: { key: candidate.key, scope, evidence_count: count },
    });
  }
  return result;
}
