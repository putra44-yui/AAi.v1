// /api/sessions/[id].js — GANTI TOTAL
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const { id } = req.query;

  // ── RENAME ──
  if (req.method === 'PUT') {
    const { title } = req.body;
    if (!title) return res.status(400).json({ error: 'title diperlukan' });

    const { error } = await supabase
      .from('sessions')
      .update({ title: title.trim() })
      .eq('id', id);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true });
  }

  // ── DELETE ──
  if (req.method === 'DELETE') {
    try {
      await supabase.from('messages').delete().eq('session_id', id);
      const { error } = await supabase.from('sessions').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('DELETE ERROR:', err);
      return res.status(500).json({ error: err.message });
    }
  }

  res.status(405).json({ error: 'Method not allowed' });
}