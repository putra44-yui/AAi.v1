import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function uniqueList(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function buildLegacyReasoningSteps(previewPayload = {}) {
  const steps = [];
  const interpretasi = String(previewPayload?.interpretasi || '').trim();
  const usedContext = uniqueList(previewPayload?.checklist_konteks?.dipakai || []).slice(0, 1);
  const missingContext = uniqueList(previewPayload?.checklist_konteks?.kurang || []).slice(0, 1);
  const potentials = uniqueList(previewPayload?.potensi_ambigu || []).slice(0, 1);
  const assumptions = uniqueList(previewPayload?.asumsi || []).slice(0, 1);

  if (interpretasi) steps.push(interpretasi);
  if (usedContext.length) steps.push(`Aku sempat memakai konteks ini saat membaca pesan: ${usedContext[0]}`);
  if (potentials.length) steps.push(`Ada bagian yang sempat kubaca hati-hati: ${potentials[0]}`);
  if (assumptions.length) steps.push(`Tanpa detail tambahan, sementara aku berpegangan pada ini: ${assumptions[0]}`);
  if (missingContext.length) steps.push(`Kalau mau lebih presisi, bagian ini tadinya masih kurang jelas: ${missingContext[0]}`);

  return uniqueList(steps.map(step => String(step || '').trim()).filter(Boolean)).slice(0, 5);
}

function buildClientPreviewPayload(previewPayload = null) {
  if (!previewPayload || typeof previewPayload !== 'object') return null;

  const reasoningSteps = Array.isArray(previewPayload.reasoning_steps)
    ? previewPayload.reasoning_steps.map(step => String(step || '').trim()).filter(Boolean)
    : buildLegacyReasoningSteps(previewPayload);

  if (!reasoningSteps.length) return null;

  return {
    preview_version: Number(previewPayload.preview_version || 2),
    title: String(previewPayload.title || 'AAI').trim() || 'AAI',
    streaming_title: String(previewPayload.streaming_title || 'AAI sedang berpikir').trim() || 'AAI sedang berpikir',
    reasoning_steps: reasoningSteps
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { session_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'session_id wajib' });

  try {
    const { data: messages, error } = await supabase
      .from('messages')
      .select('id, role, content, parent_id, created_at')
      .eq('session_id', session_id)
      .order('created_at', { ascending: true });

    if (error) throw error;

    const { data: previews } = await supabase
      .from('message_previews')
      .select('id, user_message_id, assistant_message_id, preview_json, is_ambiguous, confidence, reason_codes, created_at')
      .eq('session_id', session_id)
      .order('created_at', { ascending: true });

    const previewByAssistant = new Map((previews || [])
      .filter(p => p.assistant_message_id)
      .map(p => [p.assistant_message_id, p]));
    const previewByUser = new Map((previews || [])
      .filter(p => p.user_message_id)
      .map(p => [p.user_message_id, p]));

    const enriched = (messages || []).map(msg => {
      if (msg.role !== 'assistant') return msg;
      const linked = previewByAssistant.get(msg.id) || previewByUser.get(msg.parent_id);
      if (!linked) return msg;
      return {
        ...msg,
        preview: buildClientPreviewPayload(linked.preview_json),
        preview_id: linked.id
      };
    });

    return res.status(200).json({
      success: true,
      messages: enriched,
      session_id
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}