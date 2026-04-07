import 'server-only';

function normalizeMemoryType(memoryType) {
  return String(memoryType || '').trim().toLowerCase() || 'fakta';
}

export async function getRelevantMemoriesFromDB({
  supabase,
  personId,
  status = 'active',
  normalizedKey,
  preferredTypes = [],
  minPriorityScore,
  limit = 24,
  table = 'person_memory'
}) {
  if (!supabase) {
    throw new Error('Supabase client is required');
  }

  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 24));
  let query = supabase
    .from(table)
    .select('id, key, value, confidence, observation_count, updated_at, priority_score, memory_type, category, status')
    .eq('person_id', personId)
    .eq('status', status);

  if (normalizedKey) {
    query = query.eq('key', String(normalizedKey).trim().toLowerCase());
  }

  const normalizedPreferredTypes = (Array.isArray(preferredTypes) ? preferredTypes : [])
    .map((item) => normalizeMemoryType(item))
    .filter(Boolean);

  if (normalizedPreferredTypes.length > 0) {
    query = query.in('memory_type', normalizedPreferredTypes);
  }

  if (Number.isFinite(minPriorityScore)) {
    query = query.gte('priority_score', Number(minPriorityScore));
  }

  const { data, error } = await query
    .order('priority_score', { ascending: false })
    .order('updated_at', { ascending: false })
    .limit(safeLimit);

  if (error) {
    throw new Error(error.message);
  }

  return data || [];
}
