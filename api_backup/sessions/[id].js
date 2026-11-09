// Session actions require the owning user ID; the Worker route applies the same check.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  const { id, user_id } = req.query;
  if (!id || !user_id) {
    return res.status(400).json({ error: 'id dan user_id wajib' });
  }

  try {
    const { data: owned, error: ownershipError } = await supabase
      .from('sessions')
      .select('id')
      .eq('id', id)
      .eq('user_id', user_id)
      .maybeSingle();

    if (ownershipError) throw ownershipError;
    if (!owned) return res.status(404).json({ error: 'Sesi tidak ditemukan' });

    if (req.method === 'PUT') {
      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      if (!title || title.length > 120) {
        return res.status(400).json({ error: 'Judul harus berisi 1–120 karakter' });
      }

      const { data, error } = await supabase
        .from('sessions')
        .update({ title, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', user_id)
        .select('id')
        .maybeSingle();

      if (error) throw error;
      return data
        ? res.status(200).json({ success: true })
        : res.status(404).json({ error: 'Sesi tidak ditemukan' });
    }

    if (req.method === 'DELETE') {
      // messages, previews, and file jobs reference sessions with ON DELETE CASCADE.
      // Deleting the owned session lets PostgreSQL clean up its dependent rows atomically.
      const { data, error } = await supabase
        .from('sessions')
        .delete()
        .eq('id', id)
        .eq('user_id', user_id)
        .select('id')
        .maybeSingle();

      if (error) throw error;
      return data
        ? res.status(200).json({ success: true })
        : res.status(404).json({ error: 'Sesi tidak ditemukan' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[AAi sessions] action failed:', error);
    return res.status(500).json({ error: 'Gagal memproses sesi.' });
  }
}
