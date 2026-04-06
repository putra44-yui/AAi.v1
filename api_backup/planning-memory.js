import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getPersonIdByUserId(userId) {
  if (!userId) return { personId: null, error: 'user_id wajib' };

  const { data, error } = await supabase
    .from('users')
    .select('id, person_id')
    .eq('id', userId)
    .limit(1)
    .maybeSingle();

  if (error) return { personId: null, error: error.message };
  if (!data?.person_id) return { personId: null, error: 'User tidak terhubung ke person' };

  return { personId: data.person_id, error: null };
}

function normalizeTags(input) {
  if (!input) return [];
  if (Array.isArray(input)) {
    return [...new Set(input
      .map(tag => String(tag || '').trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 12))];
  }

  return [...new Set(String(input)
    .split(',')
    .map(tag => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 12))];
}

function normalizeLimit(rawLimit) {
  const n = Number.parseInt(rawLimit, 10);
  if (Number.isNaN(n) || n <= 0) return 20;
  return Math.min(n, 100);
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const { user_id, q = '', category = '', limit = '20' } = req.query;
    const { personId, error: personError } = await getPersonIdByUserId(user_id);
    if (personError) return res.status(400).json({ error: personError });

    let query = supabase
      .from('planning_memory')
      .select('id, title, content, category, tags, priority, created_at, updated_at')
      .eq('person_id', personId)
      .order('priority', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(normalizeLimit(limit));

    const cleanCategory = String(category || '').trim().toLowerCase();
    if (cleanCategory) {
      query = query.eq('category', cleanCategory);
    }

    const cleanQuery = String(q || '').trim();
    if (cleanQuery) {
      const escaped = cleanQuery.replace(/,/g, ' ');
      query = query.or(`title.ilike.%${escaped}%,content.ilike.%${escaped}%`);
    }

    const { data, error } = await query;
    if (error) return res.status(500).json({ error: error.message });

    return res.status(200).json({ items: data || [] });
  }

  if (req.method === 'POST') {
    const {
      user_id,
      title,
      content = '',
      category = 'rencana',
      tags = [],
      priority = 0
    } = req.body || {};

    const cleanTitle = String(title || '').trim();
    const cleanContent = String(content || '').trim();
    const cleanCategory = String(category || 'rencana').trim().toLowerCase().slice(0, 40) || 'rencana';

    if (!cleanTitle) {
      return res.status(400).json({ error: 'title wajib diisi' });
    }

    const { personId, error: personError } = await getPersonIdByUserId(user_id);
    if (personError) return res.status(400).json({ error: personError });

    const payload = {
      person_id: personId,
      title: cleanTitle,
      content: cleanContent,
      category: cleanCategory,
      tags: normalizeTags(tags),
      priority: Number.isFinite(Number(priority)) ? Number(priority) : 0,
      created_by: user_id,
      updated_by: user_id
    };

    const { data, error } = await supabase
      .from('planning_memory')
      .insert(payload)
      .select('id, title, content, category, tags, priority, created_at, updated_at')
      .single();

    if (error) return res.status(500).json({ error: error.message });

    return res.status(201).json({ item: data });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
