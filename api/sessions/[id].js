// /pages/api/sessions/[id].js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;

  try {
    // hapus child dulu (kalau ada FK)
    await supabase.from('messages').delete().eq('session_id', id);

    const { error } = await supabase
      .from('sessions')
      .delete()
      .eq('id', id);

    if (error) throw error;

    res.status(200).json({ success: true });
  } catch (err) {
    console.error('DELETE ERROR:', err);
    res.status(500).json({ error: err.message });
  }
}