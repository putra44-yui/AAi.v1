const LOCKED_KEYS_CACHE_TTL_MS = 5 * 60 * 1000;
const lockedKeysCache = new Map();
const lockedKeysInflightFetches = new Map();

function normalizeMemoryKey(memoryKey = '') {
  return String(memoryKey || '').trim().toLowerCase();
}

function cloneLockedKeySet(keys = []) {
  return new Set((Array.isArray(keys) ? keys : []).filter(Boolean));
}

export function clearLockedMemoryKeysCache(userId = null) {
  if (userId) {
    lockedKeysCache.delete(String(userId));
    lockedKeysInflightFetches.delete(String(userId));
    return;
  }

  lockedKeysCache.clear();
  lockedKeysInflightFetches.clear();
}

export async function getLockedMemoryKeys({
  supabase,
  userId,
  bypassCache = false
}) {
  if (!userId) {
    return new Set();
  }

  const cacheKey = String(userId);
  const now = Date.now();
  const cached = lockedKeysCache.get(cacheKey);
  if (!bypassCache && cached && cached.expiresAt > now) {
    return cloneLockedKeySet(cached.keys);
  }

  const pendingFetch = lockedKeysInflightFetches.get(cacheKey);
  if (pendingFetch) {
    const keys = await pendingFetch;
    return cloneLockedKeySet(keys);
  }

  const fetchPromise = (async () => {
    const { data, error } = await supabase
      .from('memories')
      .select('key')
      .eq('user_id', userId)
      .eq('is_locked', true);

    if (error) {
      if (cached?.keys) {
        return cached.keys;
      }
      throw new Error(error.message);
    }

    const normalizedKeys = (Array.isArray(data) ? data : [])
      .map((row) => normalizeMemoryKey(String((row || {}).key || '')))
      .filter(Boolean);

    lockedKeysCache.set(cacheKey, {
      expiresAt: Date.now() + LOCKED_KEYS_CACHE_TTL_MS,
      keys: normalizedKeys
    });

    return normalizedKeys;
  })().finally(() => {
    lockedKeysInflightFetches.delete(cacheKey);
  });

  lockedKeysInflightFetches.set(cacheKey, fetchPromise);
  const keys = await fetchPromise;
  return cloneLockedKeySet(keys);
}

export function formatMemoryContent(memoryKey, content) {
  return `${normalizeMemoryKey(memoryKey)}: ${String(content || '').trim()}`;
}

export async function saveMemoryWithLockGuard({
  supabase,
  userId,
  memoryKey,
  content,
  evidenceChain
}) {
  const normalizedKey = normalizeMemoryKey(memoryKey);
  const normalizedContent = String(content || '').trim();

  const { data: existingMemory, error: fetchError } = await supabase
    .from('memories')
    .select('id, is_locked')
    .eq('user_id', userId)
    .eq('key', normalizedKey)
    .limit(1)
    .maybeSingle();

  if (fetchError) {
    throw new Error(fetchError.message);
  }

  if (existingMemory?.is_locked) {
    const { data: draftRow, error: draftError } = await supabase
      .from('draft_memories')
      .insert({
        memory_id: existingMemory.id,
        user_id: userId,
        content: normalizedContent,
        evidence_chain: evidenceChain
      })
      .select('id')
      .single();

    if (draftError) {
      return {
        status: 'locked',
        memoryId: existingMemory.id,
        draftId: null
      };
    }

    return {
      status: 'draft',
      memoryId: existingMemory.id,
      draftId: draftRow?.id || null
    };
  }

  if (existingMemory?.id) {
    const { data: updatedMemory, error: updateError } = await supabase
      .from('memories')
      .update({
        key: normalizedKey,
        content: normalizedContent,
        evidence_chain: evidenceChain
      })
      .eq('id', existingMemory.id)
      .select('id')
      .single();

    if (updateError) {
      throw new Error(updateError.message);
    }

    return {
      status: 'saved',
      memoryId: updatedMemory?.id || existingMemory.id,
      draftId: null
    };
  }

  const { data: insertedMemory, error: insertError } = await supabase
    .from('memories')
    .insert({
      user_id: userId,
      key: normalizedKey,
      content: normalizedContent,
      evidence_chain: evidenceChain,
      is_locked: false
    })
    .select('id')
    .single();

  if (insertError) {
    throw new Error(insertError.message);
  }

  return {
    status: 'saved',
    memoryId: insertedMemory?.id || null,
    draftId: null
  };
}

export { LOCKED_KEYS_CACHE_TTL_MS };