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

export default async function handler(req, res) {
  const { id } = req.query;
  const userId = req.method === 'GET' || req.method === 'DELETE'
    ? req.query.user_id
    : req.body?.user_id;

  const { personId, error: personError } = await getPersonIdByUserId(userId);
  if (personError) return res.status(400).json({ error: personError });

  const { data: existing, error: existingError } = await supabase
    .from('planning_memory')
    .select('id, person_id, title')
    .eq('id', id)
    .eq('person_id', personId)
    .limit(1)
    .maybeSingle();

  if (existingError) return res.status(500).json({ error: existingError.message });
  if (!existing) return res.status(404).json({ error: 'Rencana tidak ditemukan' });

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('planning_memory')
      .select('id, title, content, category, tags, priority, created_at, updated_at')
      .eq('id', id)
      .eq('person_id', personId)
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ item: data });
  }

  if (req.method === 'PUT') {
    const {
      title,
      content,
      category,
      tags,
      priority
    } = req.body || {};

    const updatePayload = {
      updated_by: userId,
      updated_at: new Date().toISOString()
    };

    if (typeof title !== 'undefined') updatePayload.title = String(title || '').trim();
    if (typeof content !== 'undefined') updatePayload.content = String(content || '').trim();
    if (typeof category !== 'undefined') updatePayload.category = String(category || '').trim().toLowerCase().slice(0, 40);
    if (typeof tags !== 'undefined') updatePayload.tags = normalizeTags(tags);
    if (typeof priority !== 'undefined') updatePayload.priority = Number.isFinite(Number(priority)) ? Number(priority) : 0;

    if (Object.prototype.hasOwnProperty.call(updatePayload, 'title') && !updatePayload.title) {
      return res.status(400).json({ error: 'title tidak boleh kosong' });
    }

    const { data, error } = await supabase
      .from('planning_memory')
      .update(updatePayload)
      .eq('id', id)
      .eq('person_id', personId)
      .select('id, title, content, category, tags, priority, created_at, updated_at')
      .single();

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ item: data });
  }

  if (req.method === 'DELETE') {
    const { error } = await supabase
      .from('planning_memory')
      .delete()
      .eq('id', id)
      .eq('person_id', personId);

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ success: true, deleted_id: id, title: existing.title });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
