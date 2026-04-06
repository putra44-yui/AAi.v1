import { createHash } from 'node:crypto';

function uniqueList(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function parseFloatEnv(name, fallbackValue, min = 0, max = 1) {
  const raw = Number.parseFloat(process.env[name] || '');
  if (Number.isNaN(raw)) return fallbackValue;
  return Math.max(min, Math.min(max, raw));
}

const IDENTITY_MEMORY_KEYS = new Set([
  'nama_panggilan',
  'nama_lengkap',
  'tanggal_lahir',
  'tempat_lahir',
  'domisili',
  'profil_mbti',
  'pola_pikir_inti',
  'prinsip_keputusan',
  'nilai_hidup'
]);

const LOW_SIGNAL_VALUE_REGEX = /^(ok|oke|iya|ya|sip|noted|siap|terima kasih|makasih|thanks|hmm|hehe|haha|wkwk|baik)$/i;
const STABLE_MEMORY_KEYS = new Set([
  ...IDENTITY_MEMORY_KEYS,
  'role_keluarga',
  'warisan_pola_pikir'
]);
const STABLE_PATTERN_HINTS = [
  'pola_pikir',
  'mindset',
  'kerangka',
  'prinsip',
  'nilai',
  'decision',
  'value',
  'warisan'
];

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function hashText(input = '') {
  return createHash('sha1').update(String(input || '')).digest('hex');
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
  const normalized = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  // Canonical identity keys to keep updates stable (avoid duplicate variants).
  const canonicalMap = {
    nama: 'nama_panggilan',
    nama_panggilan: 'nama_panggilan',
    nama_panggil: 'nama_panggilan',
    nick_name: 'nama_panggilan',
    nickname: 'nama_panggilan',

    nama_lengkap: 'nama_lengkap',
    full_name: 'nama_lengkap',
    fullname: 'nama_lengkap',
    nama_lengkap_user: 'nama_lengkap',

    tanggal_lahir: 'tanggal_lahir',
    tgl_lahir: 'tanggal_lahir',
    lahir: 'tanggal_lahir',
    birth_date: 'tanggal_lahir',
    birthday: 'tanggal_lahir',

    tempat_lahir: 'tempat_lahir',
    birth_place: 'tempat_lahir',

    domisili: 'domisili',
    kota_tinggal: 'domisili',
    alamat: 'domisili',

    mbti: 'profil_mbti',
    tipe_kepribadian: 'profil_mbti',
    personality_type: 'profil_mbti',

    pola_pikir: 'pola_pikir_inti',
    mindset: 'pola_pikir_inti',
    kerangka_berpikir: 'pola_pikir_inti',
    cara_pikir_inti: 'pola_pikir_inti',
    thought_framework: 'pola_pikir_inti',
    gaya_berpikir: 'pola_pikir_inti',
    cognitive_style: 'pola_pikir_inti',

    prinsip_hidup: 'prinsip_keputusan',
    prinsip_keputusan: 'prinsip_keputusan',
    prinsip_ambil_keputusan: 'prinsip_keputusan',
    decision_rule: 'prinsip_keputusan',
    decision_rules: 'prinsip_keputusan',
    decision_framework: 'prinsip_keputusan',
    decision_principle: 'prinsip_keputusan',

    nilai_hidup: 'nilai_hidup',
    nilai_inti: 'nilai_hidup',
    nilai_utama: 'nilai_hidup',
    value_system: 'nilai_hidup',
    prinsip_nilai: 'nilai_hidup',
    core_values: 'nilai_hidup',
    values: 'nilai_hidup'
  };

  return canonicalMap[normalized] || normalized;
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

export function resolveMemoryScope(memory = {}) {
  const normalizedKey = normalizeMemoryKey(memory.key || memory.memory_key || '');
  const normalizedType = normalizeMemoryType(memory.memoryType || memory.memory_type || 'fakta');

  if (normalizedType === 'cara_berpikir') return 'stable';
  if (STABLE_MEMORY_KEYS.has(normalizedKey)) return 'stable';

  if (normalizedType === 'pattern' && STABLE_PATTERN_HINTS.some(token => normalizedKey.includes(token))) {
    return 'stable';
  }

  return 'dynamic';
}

export function buildMemoryClaimHash(memory = {}) {
  const normalizedKey = normalizeMemoryKey(memory.key || memory.memory_key || '');
  const normalizedType = normalizeMemoryType(memory.memoryType || memory.memory_type || 'fakta');
  const normalizedValue = normalizeMemoryText(memory.value || memory.memory_value || '');
  const normalizedCategory = normalizeMemoryText(memory.category || 'umum');
  return hashText([normalizedType, normalizedKey, normalizedValue, normalizedCategory].join('|'));
}

function buildEvidenceBucket(sessionId = '', createdAt = null) {
  if (sessionId) return `session:${String(sessionId).trim()}`;

  const date = createdAt ? new Date(createdAt) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return `hour:${safeDate.toISOString().slice(0, 13)}`;
}

function buildEvidenceContextWindow(userMessage = '', recentHistory = []) {
  const currentWindow = normalizeMemoryText(userMessage)
    .split(' ')
    .filter(Boolean)
    .slice(0, 24)
    .join(' ');

  const historyWindow = (Array.isArray(recentHistory) ? recentHistory : [])
    .filter(row => row?.role === 'user')
    .slice(-2)
    .map(row => normalizeMemoryText(row?.content || ''))
    .filter(Boolean)
    .map(text => text.split(' ').slice(0, 16).join(' '))
    .join(' | ');

  return [currentWindow, historyWindow].filter(Boolean).join(' || ').slice(0, 240);
}

export function buildUniqueContextHash({
  memory = {},
  sessionId = '',
  createdAt = null
} = {}) {
  const claimHash = buildMemoryClaimHash(memory);
  const memoryScope = resolveMemoryScope(memory);
  const bucket = buildEvidenceBucket(sessionId, createdAt);
  return hashText([bucket, claimHash, memoryScope].join('|'));
}

export function assessMemoryEvidence(memory = {}, emotionGuidance = {}, speechProfile = {}) {
  const normalizedType = normalizeMemoryType(memory.memoryType || memory.memory_type || 'fakta');
  const memoryScope = resolveMemoryScope(memory);
  const emotionalState = String(emotionGuidance.primary_emotion || 'netral').trim().toLowerCase() || 'netral';
  const emotionConfidence = Number(clampNumber(Number(emotionGuidance.confidence || 0), 0, 1).toFixed(4));
  const styleSignals = uniqueList((Array.isArray(speechProfile.styleShift) ? speechProfile.styleShift : [])
    .map(signal => String(signal || '').trim())
    .filter(Boolean));

  const caution = Boolean(emotionGuidance.needs_caution || emotionGuidance.contradiction || emotionGuidance.mixed);
  const highVolatilityEmotion = emotionConfidence >= 0.68
    && ['sedih', 'kesal', 'cemas', 'mendesak', 'butuh_bantuan'].includes(emotionalState);

  let reliability = normalizedType === 'emosi'
    ? 0.78
    : memoryScope === 'stable'
      ? 0.66
      : 0.72;

  const reasonCodes = [];

  if (caution) {
    reliability -= 0.1;
    reasonCodes.push('emotion_requires_caution');
  }

  if (highVolatilityEmotion && normalizedType !== 'emosi') {
    reliability -= memoryScope === 'stable' ? 0.2 : 0.12;
    reasonCodes.push('high_emotional_volatility');
  }

  if (styleSignals.length > 0) {
    reliability -= Math.min(0.12, styleSignals.length * 0.04);
    reasonCodes.push('style_shift_detected');
  }

  if (speechProfile?.timeAnomaly && memoryScope === 'stable') {
    reliability -= 0.05;
    reasonCodes.push('time_anomaly_detected');
  }

  if (normalizedType === 'emosi') {
    reliability += 0.06;
  }

  reliability = Number(clampNumber(reliability, 0.15, 0.95).toFixed(4));

  let status = 'validated';
  if (normalizedType !== 'emosi' && (reliability < 0.4 || (memoryScope === 'stable' && (highVolatilityEmotion || caution || reliability < 0.48)))) {
    status = 'provisional';
  }

  return {
    status,
    reliability,
    emotionalState,
    emotionConfidence,
    styleSignals,
    memoryScope,
    reasonCodes: uniqueList(reasonCodes)
  };
}

export function buildMemoryEvidenceRecord({
  personId = null,
  memoryId = null,
  memory = {},
  sourceMessageId = null,
  sessionId = null,
  userMessage = '',
  recentHistory = [],
  emotionGuidance = {},
  speechProfile = {},
  createdAt = null,
  statusOverride = ''
} = {}) {
  const assessment = assessMemoryEvidence(memory, emotionGuidance, speechProfile);
  const evidenceStatus = String(statusOverride || assessment.status).trim() || assessment.status;

  return {
    person_id: personId || null,
    memory_id: memoryId || null,
    memory_key: normalizeMemoryKey(memory.key || memory.memory_key || ''),
    memory_type: normalizeMemoryType(memory.memoryType || memory.memory_type || 'fakta'),
    memory_value: String(memory.value || memory.memory_value || '').trim(),
    memory_scope: assessment.memoryScope,
    category: String(memory.category || 'umum').trim().toLowerCase().slice(0, 60) || 'umum',
    source_message_id: sourceMessageId || null,
    source_session_id: sessionId || null,
    unique_context_hash: buildUniqueContextHash({
      memory,
      sessionId,
      createdAt
    }),
    normalized_claim_hash: buildMemoryClaimHash(memory),
    evidence_status: evidenceStatus,
    reliability_score: assessment.reliability,
    emotional_state: assessment.emotionalState,
    emotion_confidence: assessment.emotionConfidence,
    style_signals: assessment.styleSignals,
    context_window: buildEvidenceContextWindow(userMessage, recentHistory) || null
  };
}

export function computeEvidenceBackedMetrics({ validatedEvidenceCount = 1, memoryScope = 'dynamic' } = {}) {
  const observationCount = Math.max(1, Number(validatedEvidenceCount || 1));
  const baseConfidence = memoryScope === 'stable' ? 0.58 : 0.68;
  const increment = memoryScope === 'stable' ? 0.06 : 0.05;
  const confidence = Number(clampNumber(baseConfidence + Math.max(0, observationCount - 1) * increment, 0.35, 0.96).toFixed(4));

  return {
    observationCount,
    confidence,
    priorityScore: computePriorityScore(confidence, observationCount)
  };
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

  const cleanReply = text.replace(/\[(MEMORY|MEMORY_FORGET):([\s\S]*?)\](?=\s*(?:\[|$))/g, (_, tagType, payload) => {
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

export function evaluateMemoryCandidate(candidate = {}) {
  const normalizedKey = normalizeMemoryKey(candidate.key || '');
  const normalizedType = normalizeMemoryType(candidate.memoryType || 'fakta');
  const value = String(candidate.value || '').trim();
  const category = String(candidate.category || 'umum').trim().toLowerCase().slice(0, 60) || 'umum';

  if (!normalizedKey) {
    return { ok: false, reason: 'missing_key' };
  }

  if (!value) {
    return { ok: false, reason: 'missing_value' };
  }

  const isIdentityKey = IDENTITY_MEMORY_KEYS.has(normalizedKey);
  if (!isIdentityKey && value.length < 8) {
    return { ok: false, reason: 'value_too_short' };
  }

  if (!isIdentityKey && LOW_SIGNAL_VALUE_REGEX.test(value)) {
    return { ok: false, reason: 'value_low_signal' };
  }

  if (value.length > 220) {
    return { ok: false, reason: 'value_too_long' };
  }

  const keyAsText = normalizeMemoryText(normalizedKey.replace(/_/g, ' '));
  const valueAsText = normalizeMemoryText(value);
  if (!isIdentityKey && keyAsText && valueAsText && (valueAsText === keyAsText || valueAsText.startsWith(`${keyAsText} `))) {
    return { ok: false, reason: 'value_redundant_with_key' };
  }

  return {
    ok: true,
    memory: {
      key: normalizedKey,
      value,
      memoryType: normalizedType,
      category
    }
  };
}

export function filterMemoryUpserts(memoryUpserts = [], options = {}) {
  const maxItems = Math.max(1, Number(options.maxItems || 3));
  const accepted = [];
  const rejected = [];

  for (const rawCandidate of Array.isArray(memoryUpserts) ? memoryUpserts : []) {
    const verdict = evaluateMemoryCandidate(rawCandidate);
    if (!verdict.ok) {
      rejected.push({
        key: normalizeMemoryKey(rawCandidate?.key || ''),
        reason: verdict.reason
      });
      continue;
    }

    const alreadyAccepted = accepted.some(item =>
      item.key === verdict.memory.key && normalizeMemoryText(item.value) === normalizeMemoryText(verdict.memory.value)
    );

    if (alreadyAccepted) {
      rejected.push({ key: verdict.memory.key, reason: 'duplicate_in_reply' });
      continue;
    }

    accepted.push(verdict.memory);
  }

  if (accepted.length > maxItems) {
    const overflow = accepted.splice(maxItems);
    for (const item of overflow) {
      rejected.push({ key: item.key, reason: 'over_limit' });
    }
  }

  return { accepted, rejected };
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

function normalizeTextList(items = []) {
  return uniqueList((Array.isArray(items) ? items : [])
    .map(item => normalizeMemoryText(item))
    .filter(Boolean));
}

function pickPrimaryIntent(candidateIntents = []) {
  const ordered = Array.isArray(candidateIntents) ? candidateIntents.filter(Boolean) : [];
  return ordered[0] || 'general';
}

function detectSurfaceIntents(message = '') {
  const msg = String(message || '').toLowerCase();
  const intents = [];

  if (/kebiasaan|rutinitas|sering\s+apa|habit|biasanya|setiap\s+hari|tiap\s+hari/.test(msg)) intents.push('kebiasaan');
  if (/suka|favorit|kesukaan|preferensi|lebih\s+suka|nyaman|tidak\s+suka/.test(msg)) intents.push('preferensi');
  if (/gimana|orangnya|karakter|kepribadian|cara\s+berpikir|ambil\s+keputusan|menurutmu\s+aku/.test(msg)) intents.push('kepribadian');
  if (/emosi|perasaan|sedih|marah|cemas|tenang|lega|capek|stres|kecewa/.test(msg)) intents.push('emosi');
  if (/siapa|apa|kapan|dimana|mana|berapa|ingat\s+aku\s+apa|ceritakan/.test(msg)) intents.push('fakta');

  return uniqueList(intents);
}

function detectEmotionalIntent(message = '', emotionHints = {}) {
  const msg = String(message || '').toLowerCase();
  const hint = String(emotionHints.primary_emotion || '').toLowerCase();

  if (/tolong|bantu|panik|darurat|takut|cepat|sekarang|urgent|asap/.test(msg)) return 'perlu_stabilisasi';
  if (/bingung|ragu|gak\s+tahu|tidak\s+tahu|galau|bimbang/.test(msg)) return 'butuh_kejelasan';
  if (/sedih|kecewa|capek|lelah|nangis|terpukul/.test(msg) || hint === 'sedih') return 'butuh_validasi';
  if (/senang|lega|bahagia|syukur|alhamdulillah/.test(msg) || hint === 'senang') return 'butuh_penguatan';
  return 'netral';
}

function detectTimingIntent(message = '', profile = {}) {
  const msg = String(message || '').toLowerCase();
  const currentTimeSlot = String(profile.currentTimeSlot || '');
  const styleShift = Array.isArray(profile.styleShift) ? profile.styleShift : [];

  if (/sekarang|hari\s+ini|barusan|tadi|malam\s+ini|besok|nanti/.test(msg)) return 'waktu_spesifik';
  if (profile.timeAnomaly || currentTimeSlot === 'larut_malam') return 'di_luar_rutinitas';
  if (styleShift.includes('urgency_mendadak_tinggi')) return 'perubahan_mendesak';
  return 'rutin';
}

function detectRelationSignals(message = '', options = {}) {
  const msg = String(message || '').toLowerCase();
  const familyNames = normalizeTextList(options.familyNames || []);
  const friendNames = normalizeTextList(options.friendNames || []);
  const signals = [];
  const mentionedNames = [];

  const familyKeywords = [
    'anak', 'istri', 'suami', 'ayah', 'ibu', 'mama', 'papa', 'rosalia', 'keluarga', 'teman', 'sahabat'
  ];

  for (const keyword of familyKeywords) {
    if (msg.includes(keyword)) signals.push(keyword);
  }

  for (const name of [...familyNames, ...friendNames]) {
    if (name && msg.includes(name)) mentionedNames.push(name);
  }

  return {
    signals: uniqueList(signals),
    mentionedNames: uniqueList(mentionedNames),
    hasRelationFocus: signals.length > 0 || mentionedNames.length > 0
  };
}

export function analyzeMemoryIntent(message = '', options = {}) {
  const surfaceIntents = detectSurfaceIntents(message);
  const emotionalIntent = detectEmotionalIntent(message, options.emotionHints || {});
  const timingIntent = detectTimingIntent(message, options.speechProfile || {});
  const relationSignals = detectRelationSignals(message, {
    familyNames: options.familyNames,
    friendNames: options.friendNames
  });

  const candidateIntents = [...surfaceIntents];
  if (relationSignals.hasRelationFocus) candidateIntents.push('relasi');
  if (emotionalIntent === 'butuh_validasi' || emotionalIntent === 'perlu_stabilisasi') candidateIntents.push('emosi');
  if (timingIntent === 'di_luar_rutinitas') candidateIntents.push('kebiasaan');
  if (candidateIntents.length === 0) candidateIntents.push('general');

  const primaryIntent = pickPrimaryIntent(candidateIntents);
  const preferredTypes = uniqueList(candidateIntents.flatMap(intent => getIntentMemoryTypes(intent)));

  const reasoning = [];
  if (surfaceIntents.length > 0) reasoning.push(`surface=${surfaceIntents.join(',')}`);
  if (emotionalIntent !== 'netral') reasoning.push(`emosi=${emotionalIntent}`);
  if (timingIntent !== 'rutin') reasoning.push(`timing=${timingIntent}`);
  if (relationSignals.hasRelationFocus) reasoning.push(`relasi=${relationSignals.signals.concat(relationSignals.mentionedNames).join(',')}`);

  return {
    intent: primaryIntent,
    intents: uniqueList(candidateIntents),
    preferredTypes: preferredTypes.length > 0 ? preferredTypes : getIntentMemoryTypes('general'),
    emotionalIntent,
    timingIntent,
    relationSignals,
    reasoning
  };
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
  return analyzeMemoryIntent(message).intent;
}

export function getIntentMemoryTypes(intent = 'general') {
  const intentToMemoryType = {
    kebiasaan: ['kebiasaan', 'pattern'],
    preferensi: ['preferensi', 'pattern'],
    kepribadian: ['cara_berpikir', 'pattern', 'emosi'],
    emosi: ['emosi', 'pattern'],
    relasi: ['pattern', 'emosi', 'fakta'],
    fakta: ['fakta', 'pattern'],
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

export function computeRelevanceToQuery(memory = {}, message = '', preferredTypes = [], contextSignals = {}) {
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
  const relationTerms = [
    ...(contextSignals.relationSignals?.signals || []),
    ...(contextSignals.relationSignals?.mentionedNames || [])
  ].map(normalizeMemoryText);
  const relationBoost = relationTerms.some(term => term && memoryText.includes(term)) ? 0.18 : 0;
  const timeBoost = contextSignals.timingIntent === 'di_luar_rutinitas' && ['pattern', 'kebiasaan', 'emosi'].includes(normalizedType)
    ? 0.12
    : 0;
  const emotionalBoost = ['butuh_validasi', 'perlu_stabilisasi'].includes(contextSignals.emotionalIntent)
    && ['emosi', 'pattern', 'cara_berpikir'].includes(normalizedType)
      ? 0.15
      : 0;
  const recurrentTopics = normalizeTextList(contextSignals.recurrentTopics || []);
  const topicalBoost = recurrentTopics.some(topic => topic && memoryText.includes(topic)) ? 0.12 : 0;

  return Number(Math.min(1, lexical + typeBoost + categoryBoost + relationBoost + timeBoost + emotionalBoost + topicalBoost).toFixed(4));
}

export function selectRelevantMemories(memories = [], userMessage = '', options = {}) {
  if (!Array.isArray(memories) || memories.length === 0) {
    const emptyAnalysis = analyzeMemoryIntent(userMessage, options);
    return {
      items: [],
      intent: emptyAnalysis.intent,
      intents: emptyAnalysis.intents,
      preferredTypes: emptyAnalysis.preferredTypes,
      emotionalIntent: emptyAnalysis.emotionalIntent,
      timingIntent: emptyAnalysis.timingIntent,
      relationSignals: emptyAnalysis.relationSignals,
      reasoning: emptyAnalysis.reasoning
    };
  }

  const limit = Math.max(6, Number(options.limit || 24));
  const weights = options.weights || { priority: 0.55, relevance: 0.35, freshness: 0.10 };
  const minPreferredRelevance = Number(options.minPreferredRelevance ?? 0.18);
  const minOtherRelevance = Number(options.minOtherRelevance ?? 0.28);

  const intentAnalysis = analyzeMemoryIntent(userMessage, options);
  const intent = intentAnalysis.intent;
  const preferredTypes = intentAnalysis.preferredTypes;

  const scored = memories.map(memory => {
    const basePriority = Number(memory.priority_score || computePriorityScore(memory.confidence || 0.7, memory.observation_count || 1));
    const relevance = computeRelevanceToQuery(memory, userMessage, preferredTypes, {
      emotionalIntent: intentAnalysis.emotionalIntent,
      timingIntent: intentAnalysis.timingIntent,
      relationSignals: intentAnalysis.relationSignals,
      recurrentTopics: options.recurrentTopics || []
    });
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

  return {
    items: selected.slice(0, limit),
    intent,
    intents: intentAnalysis.intents,
    preferredTypes,
    emotionalIntent: intentAnalysis.emotionalIntent,
    timingIntent: intentAnalysis.timingIntent,
    relationSignals: intentAnalysis.relationSignals,
    reasoning: intentAnalysis.reasoning
  };
}
