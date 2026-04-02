import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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

    return res.status(200).json({
      success: true,
      messages: messages || [],
      session_id
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}