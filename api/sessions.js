import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id wajib' });

    const { data, error } = await supabase
      .from('sessions')
      .select('id, title, updated_at')
      .eq('user_id', user_id)
      .order('updated_at', { ascending: false });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json(data || []);
  }

  return res.status(405).json({ error: 'Method not allowed' });
}