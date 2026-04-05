function uniqueList(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function parseFloatEnv(name, fallbackValue, min = 0, max = 1) {
  const raw = Number.parseFloat(process.env[name] || '');
  if (Number.isNaN(raw)) return fallbackValue;
  return Math.max(min, Math.min(max, raw));
}

export function normalizeMemoryType(input = '') {
  const normalized = String(input || '').trim().toLowerCase().replace(/\s+/g, '_');
  if (['pattern', 'kebiasaan', 'cara_berpikir', 'preferensi', 'emosi', 'fakta'].includes(normalized)) {
    return normalized;
  }
  if (normalized === 'cara_berfikir') return 'cara_berpikir';
  if (normalized === 'cara_pikir') return 'cara_berpikir';
  if (normalized === 'habit') return 'kebiasaan';
  if (normalized === 'thinking_style') return 'cara_berpikir';
  return 'fakta';
}

export function normalizeMemoryKey(input = '') {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function normalizeMemoryText(input = '') {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function computePriorityScore(confidence = 0.7, observationCount = 1) {
  const clampedConfidence = Math.max(0.05, Math.min(0.99, Number(confidence || 0.7)));
  const seenFactor = Math.max(0.3, Math.min(1.0, Number(observationCount || 1) / 5));
  return Number((clampedConfidence * seenFactor).toFixed(4));
}

export function jaccardSimilarity(a = '', b = '') {
  const setA = new Set(normalizeMemoryText(a).split(' ').filter(Boolean));
  const setB = new Set(normalizeMemoryText(b).split(' ').filter(Boolean));
  if (!setA.size && !setB.size) return 1;
  if (!setA.size || !setB.size) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }

  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

export function parseMemoryTagPayload(payload = '') {
  const raw = String(payload || '').trim();
  if (!raw) return null;

  if (!raw.includes(';') && !/\bkey\s*=|\bvalue\s*=|\btype\s*=|\bmemory_type\s*=|\bcategory\s*=/i.test(raw)) {
    const delimiterIndex = raw.indexOf('=');
    if (delimiterIndex > 0) {
      const key = normalizeMemoryKey(raw.slice(0, delimiterIndex));
      const value = raw.slice(delimiterIndex + 1).trim();
      if (!key || !value) return null;
      return { key, value, memoryType: 'fakta', category: 'umum' };
    }
    return null;
  }

  const fields = {};
  for (const segment of raw.split(';')) {
    const cleanSegment = segment.trim();
    if (!cleanSegment) continue;
    const idx = cleanSegment.indexOf('=');
    if (idx <= 0) continue;
    const field = cleanSegment.slice(0, idx).trim().toLowerCase();
    const value = cleanSegment.slice(idx + 1).trim();
    if (!value) continue;
    fields[field] = value;
  }

  const key = normalizeMemoryKey(fields.key || fields.mem_key || fields.label || '');
  const value = String(fields.value || fields.val || fields.fact || '').trim();
  if (!key || !value) return null;

  return {
    key,
    value,
    memoryType: normalizeMemoryType(fields.memory_type || fields.type || 'fakta'),
    category: String(fields.category || 'umum').trim().toLowerCase().slice(0, 60) || 'umum'
  };
}

export function parseMemoryInstructionTags(rawReply = '') {
  const text = String(rawReply || '');
  const memoryUpserts = [];
  const forgetKeys = [];

  const cleanReply = text.replace(/\[(MEMORY|MEMORY_FORGET):([^\]]+)\]/g, (_, tagType, payload) => {
    if (tagType === 'MEMORY_FORGET') {
      const parsed = parseMemoryTagPayload(payload);
      if (parsed?.key) forgetKeys.push(parsed.key);
      else {
        const fallbackKey = normalizeMemoryKey(String(payload || '').replace(/^key\s*=/i, '').trim());
        if (fallbackKey) forgetKeys.push(fallbackKey);
      }
      return '';
    }

    const parsed = parseMemoryTagPayload(payload);
    if (parsed) memoryUpserts.push(parsed);
    return '';
  });

  return {
    cleanReply: cleanReply.trimEnd(),
    memoryUpserts: uniqueList(memoryUpserts.map(m => JSON.stringify(m))).map(item => JSON.parse(item)),
    forgetKeys: uniqueList(forgetKeys)
  };
}

function humanizeMemoryLabel(input = '') {
  return String(input || '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildMemoryBullet(memory = {}) {
  const value = String(memory.value || '').trim();
  const fallback = humanizeMemoryLabel(memory.key || 'memori tanpa detail');
  return `- ${value || fallback}`;
}

export function buildMemoryContext(memories = []) {
  if (!Array.isArray(memories) || memories.length === 0) {
    return 'Belum ada memori personal yang relevan.';
  }

  const sections = [
    { title: 'POLA PERILAKU', types: ['pattern', 'kebiasaan'] },
    { title: 'CARA BERPIKIR', types: ['cara_berpikir'] },
    { title: 'PREFERENSI', types: ['preferensi'] },
    { title: 'EMOSI', types: ['emosi'] },
    { title: 'FAKTA KUNCI', types: ['fakta'] }
  ];

  const blocks = [];
  for (const section of sections) {
    const rows = uniqueList(memories
      .filter(memory => section.types.includes(normalizeMemoryType(memory.memory_type || 'fakta')))
      .map(buildMemoryBullet));

    if (!rows.length) continue;
    blocks.push(`[${section.title}]\n${rows.join('\n')}`);
  }

  return blocks.join('\n\n') || 'Belum ada memori personal yang relevan.';
}

export function detectMemoryIntent(message = '') {
  const msg = String(message || '').toLowerCase();

  if (/kebiasaan|rutinitas|sering\s+apa|habit/.test(msg)) return 'kebiasaan';
  if (/suka|favorit|kesukaan|preferensi|lebih\s+suka/.test(msg)) return 'preferensi';
  if (/gimana|orangnya|karakter|kepribadian|cara\s+berpikir|ambil\s+keputusan/.test(msg)) return 'kepribadian';
  if (/emosi|perasaan|sedih|marah|cemas|tenang/.test(msg)) return 'emosi';

  return 'general';
}

export function getIntentMemoryTypes(intent = 'general') {
  const intentToMemoryType = {
    kebiasaan: ['kebiasaan', 'pattern'],
    preferensi: ['preferensi', 'pattern'],
    kepribadian: ['cara_berpikir', 'pattern', 'emosi'],
    emosi: ['emosi', 'pattern'],
    general: ['fakta', 'pattern', 'kebiasaan', 'preferensi', 'cara_berpikir', 'emosi']
  };

  return intentToMemoryType[intent] || intentToMemoryType.general;
}

export function resolveMemoryScoreWeights() {
  const priorityWeight = parseFloatEnv('AAI_MEMORY_WEIGHT_PRIORITY', 0.55, 0, 1);
  const relevanceWeight = parseFloatEnv('AAI_MEMORY_WEIGHT_RELEVANCE', 0.35, 0, 1);
  const freshnessWeight = parseFloatEnv('AAI_MEMORY_WEIGHT_FRESHNESS', 0.10, 0, 1);

  const total = priorityWeight + relevanceWeight + freshnessWeight;
  if (total <= 0) {
    return { priority: 0.55, relevance: 0.35, freshness: 0.10 };
  }

  return {
    priority: Number((priorityWeight / total).toFixed(4)),
    relevance: Number((relevanceWeight / total).toFixed(4)),
    freshness: Number((freshnessWeight / total).toFixed(4))
  };
}

export function normalizeMemoryExperimentMode(mode = '') {
  return String(mode || '').toLowerCase().trim() === 'context-heavy'
    ? 'context-heavy'
    : 'balanced';
}

export function resolveMemoryExperimentProfile(mode, defaults) {
  const normalizedMode = normalizeMemoryExperimentMode(mode);

  if (normalizedMode === 'context-heavy') {
    return {
      mode: normalizedMode,
      weights: { priority: 0.35, relevance: 0.55, freshness: 0.10 },
      minPreferredRelevance: 0.14,
      minOtherRelevance: 0.34,
      relevantMemoryLimit: Math.max(18, Math.min(42, Number(defaults.relevantMemoryLimit || 24)))
    };
  }

  return {
    mode: 'balanced',
    weights: defaults.weights,
    minPreferredRelevance: defaults.minPreferredRelevance,
    minOtherRelevance: defaults.minOtherRelevance,
    relevantMemoryLimit: defaults.relevantMemoryLimit
  };
}

export function computeFreshnessScore(updatedAt) {
  if (!updatedAt) return 0.35;
  const updatedTime = new Date(updatedAt).getTime();
  if (!Number.isFinite(updatedTime)) return 0.35;

  const now = Date.now();
  const ageDays = Math.max(0, (now - updatedTime) / (1000 * 60 * 60 * 24));
  const score = Math.exp(-ageDays / 45);
  return Number(Math.max(0.15, Math.min(1, score)).toFixed(4));
}

export function computeRelevanceToQuery(memory = {}, message = '', preferredTypes = []) {
  const normalizedType = normalizeMemoryType(memory.memory_type || 'fakta');
  const query = normalizeMemoryText(message);
  const memoryText = [memory.key, memory.value, memory.category, normalizedType]
    .map(part => normalizeMemoryText(part || ''))
    .join(' ')
    .trim();

  if (!query || !memoryText) {
    return preferredTypes.includes(normalizedType) ? 0.45 : 0.2;
  }

  const lexical = jaccardSimilarity(query, memoryText);
  const typeBoost = preferredTypes.includes(normalizedType) ? 0.35 : 0.08;
  const categoryBoost = memory.category && query.includes(normalizeMemoryText(memory.category)) ? 0.15 : 0;
  return Number(Math.min(1, lexical + typeBoost + categoryBoost).toFixed(4));
}

export function selectRelevantMemories(memories = [], userMessage = '', options = {}) {
  if (!Array.isArray(memories) || memories.length === 0) {
    return { items: [], intent: 'general', preferredTypes: getIntentMemoryTypes('general') };
  }

  const limit = Math.max(6, Number(options.limit || 24));
  const weights = options.weights || { priority: 0.55, relevance: 0.35, freshness: 0.10 };
  const minPreferredRelevance = Number(options.minPreferredRelevance ?? 0.18);
  const minOtherRelevance = Number(options.minOtherRelevance ?? 0.28);

  const intent = detectMemoryIntent(userMessage);
  const preferredTypes = getIntentMemoryTypes(intent);

  const scored = memories.map(memory => {
    const basePriority = Number(memory.priority_score || computePriorityScore(memory.confidence || 0.7, memory.observation_count || 1));
    const relevance = computeRelevanceToQuery(memory, userMessage, preferredTypes);
    const freshness = computeFreshnessScore(memory.updated_at);
    const finalScore = Number((
      weights.priority * basePriority +
      weights.relevance * relevance +
      weights.freshness * freshness
    ).toFixed(4));

    return {
      ...memory,
      _intent: intent,
      _relevance: relevance,
      _freshness: freshness,
      _final_score: finalScore
    };
  });

  scored.sort((a, b) => {
    if (b._final_score !== a._final_score) return b._final_score - a._final_score;
    if ((b.priority_score || 0) !== (a.priority_score || 0)) return (b.priority_score || 0) - (a.priority_score || 0);
    return new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime();
  });

  const preferredPool = scored
    .filter(item => preferredTypes.includes(normalizeMemoryType(item.memory_type || 'fakta')))
    .filter(item => item._relevance >= minPreferredRelevance);
  const otherPool = scored
    .filter(item => !preferredTypes.includes(normalizeMemoryType(item.memory_type || 'fakta')))
    .filter(item => item._relevance >= minOtherRelevance);

  const selected = [];
  const preferredQuota = Math.min(limit, Math.max(4, Math.ceil(limit * 0.65)));

  for (const item of preferredPool) {
    if (selected.length >= preferredQuota) break;
    selected.push(item);
  }

  for (const item of otherPool) {
    if (selected.length >= limit) break;
    selected.push(item);
  }

  for (const item of scored) {
    if (selected.length >= limit) break;
    if (selected.some(existing => existing.id === item.id)) continue;
    selected.push(item);
  }

  return { items: selected.slice(0, limit), intent, preferredTypes };
}
