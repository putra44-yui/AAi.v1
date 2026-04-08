import { createClient } from '@supabase/supabase-js';
import { buildClientPreviewPayload } from './_lib/chat-preview.js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const REASONING_PREVIEW_ENABLED = String(process.env.AAI_REASONING_PREVIEW_ENABLED || '').toLowerCase() === 'true';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { session_id, user_id } = req.query;
  if (!session_id) return res.status(400).json({ error: 'session_id wajib' });
  if (!user_id) return res.status(400).json({ error: 'user_id wajib' });

  try {
    // Verifikasi kepemilikan: pastikan session ini milik user yang meminta
    const { data: sessionRow, error: sessionError } = await supabase
      .from('sessions')
      .select('id')
      .eq('id', session_id)
      .eq('user_id', user_id)
      .maybeSingle();

    if (sessionError) throw sessionError;
    if (!sessionRow) return res.status(403).json({ error: 'Akses ditolak' });

    const { data: messages, error } = await supabase
      .from('messages')
      .select('id, role, content, parent_id, created_at')
      .eq('session_id', session_id)
      .order('created_at', { ascending: true });

    if (error) throw error;

    let enriched = messages || [];
    if (REASONING_PREVIEW_ENABLED) {
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

      enriched = (messages || []).map(msg => {
        if (msg.role !== 'assistant') return msg;
        const linked = previewByAssistant.get(msg.id) || previewByUser.get(msg.parent_id);
        if (!linked) return msg;
        return {
          ...msg,
          preview: buildClientPreviewPayload(linked.preview_json),
          preview_id: linked.id
        };
      });
    }

    return res.status(200).json({
      success: true,
      messages: enriched,
      session_id
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}