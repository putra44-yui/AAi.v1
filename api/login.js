import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { username } = req.body;

  if (!username || typeof username !== 'string') {
    return res.status(400).json({ error: 'Username tidak boleh kosong.' });
  }

  const { data: user, error } = await supabase
    .from('users')
    .select('id, username')
    .eq('username', username.trim().toLowerCase())
    .single();

  if (error || !user) {
    return res.status(401).json({ error: `Username "${username}" tidak ditemukan.` });
  }

  return res.status(200).json({ user });
}