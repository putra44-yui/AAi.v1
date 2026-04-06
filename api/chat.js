export const maxDuration = 300;
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { createClient } from '@supabase/supabase-js';
import * as chatMemory from './_lib/chat-memory.js';
import * as chatContext from './_lib/chat-context.js';
import * as chatPreview from './_lib/chat-preview.js';
import * as chatProvider from './_lib/chat-provider.js';
import * as chatFiles from './_lib/chat-files.js';
import * as speechStyle from './_lib/speech-style.js';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MAIN_MODEL = "qwen/qwen3.6-plus:free";
const DEFAULT_FALLBACK_MODEL = 'qwen/qwen2.5-coder:free';
const MEMORY_TAG_PREFIX = '[MEMORY:';
const MEMORY_FORGET_TAG_PREFIX = '[MEMORY_FORGET:';
const CLARIFY_BLOCK_START = '[AAI_CLARIFY]';
const CLARIFY_BLOCK_END = '[/AAI_CLARIFY]';
const MAX_HISTORY_MESSAGES = 7;
const MAX_HISTORY_MESSAGES_COMPACT = 60;
const HISTORY_SUMMARY_MAX_MESSAGES = 6;
const HISTORY_SUMMARY_MAX_CHARS = 260;
const DEFAULT_MAX_INJECTED_MEMORIES = 120;
const RETRYABLE_OPENROUTER_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const CHECKPOINT_SUMMARY_START = '[SESSION_CHECKPOINT]';
const CHECKPOINT_SUMMARY_END = '[/SESSION_CHECKPOINT]';

const AMBIGUOUS_TERMS = ['ini', 'itu', 'dia', 'mereka', 'yang tadi', 'kayak kemarin', 'seperti biasa'];
const REASONING_STREAMING_TITLE = 'AAI sedang berpikir';
const REASONING_FINAL_TITLE = 'AAI';

function uniqueList(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function parsePositiveIntEnv(name, fallbackValue) {
  const raw = Number.parseInt(process.env[name] || '', 10);
  if (Number.isNaN(raw) || raw <= 0) return fallbackValue;
  return raw;
}

function parseFloatEnv(name, fallbackValue, min = 0, max = 1) {
  const raw = Number.parseFloat(process.env[name] || '');
  if (Number.isNaN(raw)) return fallbackValue;
  return Math.max(min, Math.min(max, raw));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function normalizeMemoryType(input = '') {
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

function normalizeMemoryKey(input = '') {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeMemoryText(input = '') {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function computePriorityScore(confidence = 0.7, observationCount = 1) {
  const clampedConfidence = Math.max(0.05, Math.min(0.99, Number(confidence || 0.7)));
  const seenFactor = Math.max(0.3, Math.min(1.0, Number(observationCount || 1) / 5));
  return Number((clampedConfidence * seenFactor).toFixed(4));
}

function jaccardSimilarity(a = '', b = '') {
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

function isMeaningfulMemoryConflict(existingValue = '', incomingValue = '') {
  const left = normalizeMemoryText(existingValue);
  const right = normalizeMemoryText(incomingValue);
  if (!left || !right) return false;
  if (left === right) return false;
  if (left.includes(right) || right.includes(left)) return false;
  if (left.length < 12 || right.length < 12) return false;

  const similarity = jaccardSimilarity(left, right);
  return similarity < 0.22;
}

function buildConflictVariantKey(baseKey = '', memoryPool = []) {
  const normalizedBase = normalizeMemoryKey(baseKey || 'memori');
  const usedKeys = new Set((memoryPool || [])
    .map(item => normalizeMemoryKey(item?.key || ''))
    .filter(Boolean));

  for (let idx = 2; idx <= 99; idx += 1) {
    const candidate = `${normalizedBase}_v${idx}`;
    if (!usedKeys.has(candidate)) return candidate;
  }

  return `${normalizedBase}_${Date.now()}`;
}

function parseMemoryTagPayload(payload = '') {
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

function parseMemoryInstructionTags(rawReply = '') {
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

/**
 * Levenshtein distance for fuzzy name matching.
 */
function levenshtein(s, t) {
  const m = s.length, n = t.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = s[i - 1] === t[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

/**
 * Returns true if two name strings are similar enough to be the same person.
 * Tolerates minor typos and casing differences.
 */
function isSimilarName(a = '', b = '') {
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return true;
  // Allow up to 2 edit-distance for short names, or 20% for longer ones
  const threshold = maxLen <= 5 ? 2 : Math.floor(maxLen * 0.2);
  return levenshtein(a, b) <= threshold;
}

/**
 * Parses friend suggestion tags from AI response.
 * Format: [SUGGEST-FRIEND:name=Yosi;intro_msg=...]
 * Returns: { cleanReply, friendSuggestions: [{name, intro_msg}, ...] }
 */
function parseFriendSuggestionTags(rawReply = '') {
  const text = String(rawReply || '');
  const friendSuggestions = [];

  const cleanReply = text.replace(/\[SUGGEST-FRIEND:([\s\S]*?)\](?=\s*(?:\[|$))/g, (_, payload) => {
    // Parse name=X;intro_msg=Y format
    const nameMatch = /name=([^;]+)/.exec(payload);
    const introMatch = /intro_msg=([^;]+)/.exec(payload);

    if (nameMatch) {
      friendSuggestions.push({
        name: decodeURIComponent(nameMatch[1]).trim(),
        intro_msg: introMatch ? decodeURIComponent(introMatch[1]).trim() : ''
      });
    }
    return '';
  });

  return {
    cleanReply: cleanReply.trimEnd(),
    friendSuggestions: uniqueList(friendSuggestions.map(f => JSON.stringify(f))).map(item => JSON.parse(item))
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

function buildMemoryContext(memories = []) {
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

function buildIdentityContext(person = {}, currentAge = '?', familyContext = '', relationContext = '') {
  return [
    '[IDENTITAS]',
    `Nama: ${person?.name || '-'}`,
    `Peran: ${person?.role || '-'}`,
    `Usia: ${currentAge || '?'}`,
    '',
    '[KELUARGA]',
    familyContext || '-',
    '',
    '[RELASI KELUARGA]',
    relationContext || 'Belum ada relasi.'
  ].join('\n');
}

function buildConsistencyLock(person = {}, relevantSelection = {}) {
  const typeLabels = {
    pattern: 'pola perilaku',
    kebiasaan: 'kebiasaan',
    cara_berpikir: 'cara berpikir',
    preferensi: 'preferensi',
    emosi: 'emosi',
    fakta: 'fakta kunci'
  };

  const prioritizedTraits = uniqueList((relevantSelection.preferredTypes || [])
    .map(type => typeLabels[normalizeMemoryType(type)])
    .filter(Boolean));

  return [
    '[CONSISTENCY LOCK]',
    `Kamu adalah representasi AI untuk ${person?.name || 'user'} sebagai ${person?.role || 'anggota keluarga'}.`,
    `Jawaban harus konsisten dengan memori terpilih, terutama pada: ${prioritizedTraits.join(', ') || 'identitas, pola perilaku, dan preferensi yang tersedia'}.`,
    'Jika data kurang, gunakan inferensi minimal yang paling masuk akal dan jangan nyatakan sebagai fakta pasti.',
    'Jangan membuat sifat, kebiasaan, emosi, atau preferensi yang bertentangan dengan memori yang tersedia.'
  ].join('\n');
}

function buildFinalContextBlock({
  userMessage = '',
  person = {},
  currentAge = '?',
  familyContext = '',
  relationContext = '',
  relevantSelection = {},
  experimentProfile = {},
  recentHistory = [],
  fileContext = ''
}) {
  const memoryText = buildMemoryContext(relevantSelection.items || []);

  return [
    buildIdentityContext(person, currentAge, familyContext, relationContext),
    '',
    buildConsistencyLock(person, relevantSelection),
    '',
    '[USER MESSAGE]',
    userMessage || '-',
    '',
    '[RELEVANT MEMORY]',
    `Intent terdeteksi: ${relevantSelection.intent || 'general'}`,
    `Tipe prioritas: ${(relevantSelection.preferredTypes || []).join(', ') || '-'}`,
    `Jumlah memori terpilih: ${Array.isArray(relevantSelection.items) ? relevantSelection.items.length : 0}`,
    `Experiment mode: ${experimentProfile.mode || 'balanced'}`,
    memoryText,
    '',
    '[LAST CHAT]',
    buildLastChatContext(recentHistory),
    ...(fileContext ? ['', '[LAMPIRAN FILE]', fileContext] : [])
  ].join('\n');
}

function detectMemoryIntent(message = '') {
  const msg = String(message || '').toLowerCase();

  if (/kebiasaan|rutinitas|sering\s+apa|habit/.test(msg)) return 'kebiasaan';
  if (/suka|favorit|kesukaan|preferensi|lebih\s+suka/.test(msg)) return 'preferensi';
  if (/gimana|orangnya|karakter|kepribadian|cara\s+berpikir|ambil\s+keputusan/.test(msg)) return 'kepribadian';
  if (/emosi|perasaan|sedih|marah|cemas|tenang/.test(msg)) return 'emosi';

  return 'general';
}

function getIntentMemoryTypes(intent = 'general') {
  const intentToMemoryType = {
    kebiasaan: ['kebiasaan', 'pattern'],
    preferensi: ['preferensi', 'pattern'],
    kepribadian: ['cara_berpikir', 'pattern', 'emosi'],
    emosi: ['emosi', 'pattern'],
    general: ['fakta', 'pattern', 'kebiasaan', 'preferensi', 'cara_berpikir', 'emosi']
  };

  return intentToMemoryType[intent] || intentToMemoryType.general;
}

function resolveMemoryScoreWeights() {
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

function normalizeMemoryExperimentMode(mode = '') {
  return String(mode || '').toLowerCase().trim() === 'context-heavy'
    ? 'context-heavy'
    : 'balanced';
}

function resolveMemoryExperimentProfile(mode, defaults) {
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

function computeFreshnessScore(updatedAt) {
  if (!updatedAt) return 0.35;
  const updatedTime = new Date(updatedAt).getTime();
  if (!Number.isFinite(updatedTime)) return 0.35;

  const now = Date.now();
  const ageDays = Math.max(0, (now - updatedTime) / (1000 * 60 * 60 * 24));
  const score = Math.exp(-ageDays / 45);
  return Number(Math.max(0.15, Math.min(1, score)).toFixed(4));
}

function computeRelevanceToQuery(memory = {}, message = '', preferredTypes = []) {
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

function selectRelevantMemories(memories = [], userMessage = '', options = {}) {
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

function buildLastChatContext(historyRows = [], maxLines = 8) {
  if (!Array.isArray(historyRows) || historyRows.length === 0) return 'Belum ada riwayat chat sebelumnya.';

  const lines = historyRows
    .slice(-maxLines)
    .map((row, idx) => {
      const role = row.role === 'assistant' ? 'AI' : row.role === 'user' ? 'User' : 'System';
      return `${idx + 1}. [${role}] ${compactHistoryMessage(row.content, 180)}`;
    });

  return lines.join('\n');
}

function sanitizeGeneratedFileBlock(content = '') {
  let clean = String(content || '').replace(/\r/g, '').trim();
  clean = clean.replace(/^```[a-zA-Z0-9_-]*\n?/i, '').replace(/\n?```$/, '');
  return clean.trim();
}

function toSlug(input = '') {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeCellValue(value) {
  return String(value == null ? '' : value)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function pickBestDelimiter(line = '') {
  const delimiters = ['#', '\t', ';', ','];
  let best = '#';
  let bestCount = -1;

  for (const delimiter of delimiters) {
    const count = line.split(delimiter).length - 1;
    if (count > bestCount) {
      best = delimiter;
      bestCount = count;
    }
  }

  return best;
}

function parseDelimitedLines(rawContent = '') {
  const clean = sanitizeGeneratedFileBlock(rawContent);
  if (!clean) return [];

  const lines = clean
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0);

  if (!lines.length) return [];

  const delimiter = pickBestDelimiter(lines[0]);
  return lines.map(line => line.split(delimiter).map(cell => cell.trim()));
}

function parseXlsbRows(rawContent = '') {
  return parseDelimitedLines(rawContent);
}

function parseSheetBlocks(rawContent = '') {
  const clean = sanitizeGeneratedFileBlock(rawContent);
  if (!clean) return [];

  const blocks = [];
  const regex = /\[\[SHEET:([^\]]+)\]\]([\s\S]*?)(?=(\[\[SHEET:[^\]]+\]\])|$)/g;
  let match;

  while ((match = regex.exec(clean)) !== null) {
    const name = String(match[1] || '').trim();
    const rows = parseDelimitedLines(match[2] || '');
    if (!name || !rows.length) continue;
    blocks.push({ name: name.slice(0, 31), rows });
  }

  if (blocks.length > 0) return blocks;

  const rows = parseXlsbRows(clean);
  if (!rows.length) return [];
  return [{ name: 'Data', rows }];
}

function findJoinColumnIndex(headersA = [], headersB = []) {
  const scoredCandidates = ['id', 'kode', 'nik', 'nip', 'email', 'no_hp', 'phone', 'nama'];

  const normalizedA = headersA.map(h => toSlug(h));
  const normalizedB = headersB.map(h => toSlug(h));

  for (const key of scoredCandidates) {
    const idxA = normalizedA.findIndex(h => h === key || h.endsWith(`_${key}`) || h.includes(key));
    const idxB = normalizedB.findIndex(h => h === key || h.endsWith(`_${key}`) || h.includes(key));
    if (idxA >= 0 && idxB >= 0) {
      return { idxA, idxB, label: key };
    }
  }

  for (let i = 0; i < normalizedA.length; i++) {
    const idxB = normalizedB.indexOf(normalizedA[i]);
    if (idxB >= 0) {
      return { idxA: i, idxB, label: normalizedA[i] || 'kolom_sama' };
    }
  }

  return { idxA: 0, idxB: 0, label: 'kolom_1' };
}

function buildSandingWorkbookSheets(sheetBlocks = []) {
  if (sheetBlocks.length < 2) return sheetBlocks;

  const sheetA = sheetBlocks[0];
  const sheetB = sheetBlocks[1];

  const [headerA = [], ...rowsA] = sheetA.rows;
  const [headerB = [], ...rowsB] = sheetB.rows;

  if (!headerA.length || !headerB.length) return sheetBlocks;

  const { idxA, idxB } = findJoinColumnIndex(headerA, headerB);
  const mapB = new Map();

  for (const row of rowsB) {
    const key = normalizeCellValue(row[idxB]);
    if (!key) continue;
    if (!mapB.has(key)) mapB.set(key, []);
    mapB.get(key).push(row);
  }

  const headerMatched = [
    ...headerA.map(h => `${sheetA.name}.${h || 'kolom'}`),
    ...headerB.map(h => `${sheetB.name}.${h || 'kolom'}`)
  ];

  const matchedRows = [headerMatched];
  const naRows = [headerMatched];
  const emptyB = new Array(headerB.length).fill('#N/A');

  for (const rowA of rowsA) {
    const key = normalizeCellValue(rowA[idxA]);
    const found = key ? mapB.get(key) : null;
    if (found && found.length) {
      for (const rowB of found) {
        matchedRows.push([...rowA, ...rowB]);
      }
      continue;
    }
    naRows.push([...rowA, ...emptyB]);
  }

  return [
    ...sheetBlocks,
    { name: 'Data Berhasil Sanding', rows: matchedRows },
    { name: 'Data Tidak Bersandingan', rows: naRows }
  ];
}

function applyWorksheetColumnWidths(ws, rows = []) {
  if (!rows.length) return;
  const maxCols = Math.max(...rows.map(r => r.length), 0);
  if (maxCols === 0) return;

  const widths = Array.from({ length: maxCols }, (_, colIdx) => {
    const maxLen = rows.reduce((acc, row) => {
      const value = row[colIdx] == null ? '' : String(row[colIdx]);
      return Math.max(acc, value.length);
    }, 6);

    return { wch: Math.min(60, Math.max(10, maxLen + 2)) };
  });

  ws['!cols'] = widths;
}

function createMemoryTagStreamFilter() {
  let buffer = '';
  let suppressingMemoryTag = false;
  let suppressingClarifyBlock = false;

  return function filterChunk(chunk = '', flush = false) {
    if (chunk) buffer += chunk;

    let visible = '';

    while (buffer.length > 0) {
      // Handle [AAI_CLARIFY]...[/AAI_CLARIFY] blocks
      if (suppressingClarifyBlock) {
        const endIdx = buffer.indexOf(CLARIFY_BLOCK_END);
        if (endIdx === -1) {
          if (flush) buffer = '';
          break;
        }
        buffer = buffer.slice(endIdx + CLARIFY_BLOCK_END.length);
        suppressingClarifyBlock = false;
        continue;
      }

      if (suppressingMemoryTag) {
        const tagEndIndex = buffer.indexOf(']');
        if (tagEndIndex === -1) {
          if (flush) buffer = '';
          break;
        }

        buffer = buffer.slice(tagEndIndex + 1);
        suppressingMemoryTag = false;
        continue;
      }

      // Check for all block/tag starts
      const blockCandidates = [
        { marker: CLARIFY_BLOCK_START, type: 'clarify' },
        { marker: MEMORY_TAG_PREFIX, type: 'memory' },
        { marker: MEMORY_FORGET_TAG_PREFIX, type: 'forget' }
      ]
        .map(item => ({ ...item, index: buffer.indexOf(item.marker) }))
        .filter(item => item.index !== -1)
        .sort((a, b) => a.index - b.index);

      if (blockCandidates.length > 0) {
        const selected = blockCandidates[0];
        visible += buffer.slice(0, selected.index);
        buffer = buffer.slice(selected.index + selected.marker.length);
        if (selected.type === 'clarify') {
          suppressingClarifyBlock = true;
        } else {
          suppressingMemoryTag = true;
        }
        continue;
      }

      if (flush) {
        visible += buffer;
        buffer = '';
        break;
      }

      const maxMarkerLength = Math.max(
        CLARIFY_BLOCK_START.length,
        MEMORY_TAG_PREFIX.length,
        MEMORY_FORGET_TAG_PREFIX.length
      );
      const safeLength = Math.max(0, buffer.length - (maxMarkerLength - 1));
      if (safeLength === 0) break;

      visible += buffer.slice(0, safeLength);
      buffer = buffer.slice(safeLength);
    }

    return visible;
  };
}

function stripClarifyControlBlocks(text = '') {
  const raw = String(text || '');
  const startIdx = raw.indexOf(CLARIFY_BLOCK_START);
  if (startIdx === -1) {
    return { text: raw.trimEnd(), hadBlock: false };
  }

  const endIdx = raw.indexOf(CLARIFY_BLOCK_END, startIdx + CLARIFY_BLOCK_START.length);
  const stripped = endIdx === -1
    ? raw.slice(0, startIdx)
    : `${raw.slice(0, startIdx)}${raw.slice(endIdx + CLARIFY_BLOCK_END.length)}`;

  return {
    text: stripped.replace(/\n{3,}/g, '\n\n').trimEnd(),
    hadBlock: true
  };
}

function extractCheckpointSummary(text = '') {
  const raw = String(text || '').trim();
  if (!raw) return '';

  const startIdx = raw.indexOf(CHECKPOINT_SUMMARY_START);
  if (startIdx === -1) {
    return compactHistoryMessage(raw, 2600);
  }

  const endIdx = raw.indexOf(CHECKPOINT_SUMMARY_END, startIdx + CHECKPOINT_SUMMARY_START.length);
  const summaryText = endIdx === -1
    ? raw.slice(startIdx + CHECKPOINT_SUMMARY_START.length)
    : raw.slice(startIdx + CHECKPOINT_SUMMARY_START.length, endIdx);

  return compactHistoryMessage(summaryText, 2600);
}

function stripCheckpointControlBlocks(text = '') {
  const raw = String(text || '');
  const startIdx = raw.indexOf(CHECKPOINT_SUMMARY_START);
  if (startIdx === -1) {
    return { text: raw.trimEnd(), hadBlock: false };
  }

  const endIdx = raw.indexOf(CHECKPOINT_SUMMARY_END, startIdx + CHECKPOINT_SUMMARY_START.length);
  const stripped = endIdx === -1
    ? raw.slice(0, startIdx)
    : `${raw.slice(0, startIdx)}${raw.slice(endIdx + CHECKPOINT_SUMMARY_END.length)}`;

  return {
    text: stripped.replace(/\n{3,}/g, '\n\n').trimEnd(),
    hadBlock: true
  };
}

function compactHistoryMessage(content = '', maxChars = HISTORY_SUMMARY_MAX_CHARS) {
  const normalized = String(content || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return '-';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3)}...`;
}

function ensureVisibleAssistantReply(text = '', reason = 'unknown') {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (cleaned) return cleaned;

  console.warn('[Response] Empty assistant reply after sanitization.', { reason });
  return 'Maaf, respons tadi tidak terbentuk sempurna. Coba kirim ulang pesanmu, ya.';
}

async function enqueueFileGenerationJob({ sessionId, userId, messageId, sourceText, pendingText, fileCount }) {
  const { data, error } = await supabase
    .from('file_generation_jobs')
    .insert({
      session_id: sessionId,
      user_id: userId || null,
      message_id: messageId,
      status: 'pending',
      source_text: sourceText,
      pending_text: pendingText,
      file_count: Number(fileCount || 0)
    })
    .select('id, message_id, session_id, status, file_count, created_at')
    .single();

  if (error) throw error;
  return data;
}

function isDuplicateMemoryEvidenceError(error = null) {
  const message = String(error?.message || '').toLowerCase();
  return (error?.code === '23505' && message.includes('person_memory_evidence'))
    || message.includes('uq_person_memory_evidence_context')
    || message.includes('unique_context_hash');
}

async function findMemoryEvidenceByContextHash(personId, uniqueContextHash) {
  if (!personId || !uniqueContextHash) return null;

  const { data, error } = await supabase
    .from('person_memory_evidence')
    .select('id, memory_id, evidence_status, reliability_score')
    .eq('person_id', personId)
    .eq('unique_context_hash', uniqueContextHash)
    .maybeSingle();

  if (error) throw error;
  return data || null;
}

async function insertMemoryEvidence(payload = {}) {
  const { data, error } = await supabase
    .from('person_memory_evidence')
    .insert(payload)
    .select('id, memory_id, evidence_status, reliability_score, unique_context_hash')
    .single();

  if (error) {
    if (isDuplicateMemoryEvidenceError(error)) {
      return { data: null, duplicate: true };
    }
    throw error;
  }

  return { data, duplicate: false };
}

async function countValidatedMemoryEvidence(memoryId) {
  if (!memoryId) return 0;

  const { count, error } = await supabase
    .from('person_memory_evidence')
    .select('id', { count: 'exact', head: true })
    .eq('memory_id', memoryId)
    .eq('evidence_status', 'validated');

  if (error) throw error;
  return Number(count || 0);
}

async function writeLegacyAuditEntries(entries = []) {
  const rows = (Array.isArray(entries) ? entries : [])
    .filter(Boolean)
    .map(entry => ({
      person_id: entry.person_id || null,
      memory_id: entry.memory_id || null,
      evidence_id: entry.evidence_id || null,
      session_id: entry.session_id || null,
      source_message_id: entry.source_message_id || null,
      event_type: String(entry.event_type || entry.type || 'memory_event').trim() || 'memory_event',
      reason_code: entry.reason_code || entry.reason || null,
      payload: entry.payload && typeof entry.payload === 'object' ? entry.payload : {}
    }));

  if (!rows.length) return;

  try {
    const { error } = await supabase.from('legacy_audit_log').insert(rows);
    if (error) throw error;
  } catch (error) {
    console.error('[LegacyAudit] Gagal simpan log:', error.message);
  }
}

function buildOlderHistorySummary(messages = []) {
  if (!Array.isArray(messages) || messages.length === 0) return '';

  const sampledMessages = messages.slice(-HISTORY_SUMMARY_MAX_MESSAGES);
  const omittedCount = Math.max(0, messages.length - sampledMessages.length);
  const lines = sampledMessages.map((message, index) => {
    const roleLabel = message.role === 'assistant'
      ? 'AI'
      : message.role === 'user'
        ? 'User'
        : String(message.role || 'system');

    return `${index + 1}. [${roleLabel}] ${compactHistoryMessage(message.content, HISTORY_SUMMARY_MAX_CHARS)}`;
  });

  return [
    'Konteks percakapan yang lebih lama sudah dipadatkan agar tetap muat di konteks model.',
    `Total pesan lama yang diringkas: ${messages.length}.`,
    ...(omittedCount > 0 ? [`Pesan yang tidak ditampilkan penuh: ${omittedCount}.`] : []),
    'Cuplikan inti konteks lama:',
    ...lines
  ].join('\n');
}

async function extractPdfText(buffer) {
  let parser = null;

  try {
    // Lazy import to avoid serverless cold-start crash when optional DOM/canvas
    // dependencies from pdf-parse are unavailable in Vercel runtime.
    const { PDFParse } = await import('pdf-parse');
    parser = new PDFParse({ data: buffer });
    const result = await parser.getText({ lineEnforce: true });
    const text = String(result?.text || '').replace(/\n{3,}/g, '\n\n').trim();
    return text;
  } catch (error) {
    console.warn('[PDF] Ekstraksi dilewati:', error?.message || error);
    return '';
  } finally {
    if (parser) {
      await parser.destroy().catch(() => {});
    }
  }
}

function collectMatchedTerms(text = '', phrases = []) {
  const normalized = String(text || '').toLowerCase();
  if (!normalized) return [];
  return uniqueList((phrases || []).filter(term => normalized.includes(String(term).toLowerCase())));
}

function detectConversationEmotion(userMessage = '', recentHistory = []) {
  const currentText = String(userMessage || '').toLowerCase();
  const historyText = (recentHistory || [])
    .slice(-4)
    .map(row => String(row?.content || '').toLowerCase())
    .join(' \n ');

  const rules = [
    {
      label: 'sedih',
      opening: 'Sepertinya perasaannya lagi agak berat.',
      phrases: ['sedih', 'kecewa', 'nangis', 'galau', 'capek', 'lelah', 'drop', 'down', 'terpuruk', 'putus asa', 'stres']
    },
    {
      label: 'kesal',
      opening: 'Ada nada kesal yang cukup terasa di sini.',
      phrases: ['marah', 'kesal', 'jengkel', 'dongkol', 'sebal', 'muak', 'geram', 'emosi']
    },
    {
      label: 'cemas',
      opening: 'Aku menangkap ada kebingungan atau kekhawatiran di balik pesan ini.',
      phrases: ['cemas', 'khawatir', 'takut', 'bingung', 'panik', 'gimana ya', 'bagaimana ya']
    },
    {
      label: 'mendesak',
      opening: 'Nada pesannya terasa cukup buru-buru.',
      phrases: ['segera', 'cepat', 'urgent', 'darurat', 'sekarang', 'asap']
    },
    {
      label: 'senang',
      opening: 'Nada pesannya terasa lebih ringan dan positif.',
      phrases: ['senang', 'lega', 'bahagia', 'syukur', 'alhamdulillah', 'mantap', 'asik']
    },
    {
      label: 'butuh_bantuan',
      opening: 'Dia kelihatannya memang lagi butuh bantuan.',
      phrases: ['tolong', 'bantu', 'bisa bantu', 'butuh bantuan']
    }
  ];

  let best = {
    label: 'netral',
    opening: '',
    evidence: [],
    fromHistory: false,
    score: 0
  };

  for (const rule of rules) {
    const currentMatches = collectMatchedTerms(currentText, rule.phrases);
    const historyMatches = collectMatchedTerms(historyText, rule.phrases);
    const score = currentMatches.length * 2 + historyMatches.length * 0.75;

    if (score <= best.score) continue;

    best = {
      label: rule.label,
      opening: rule.opening,
      evidence: uniqueList([...currentMatches, ...historyMatches]),
      fromHistory: historyMatches.length > 0,
      score
    };
  }

  return best;
}

function detectReasoningIntent(userMessage = '', fileContext = '', targetPersona = '') {
  const normalized = String(userMessage || '').toLowerCase();
  const hasFileContext = !!String(fileContext || '').trim();

  if (hasFileContext) {
    return {
      key: 'file',
      step: 'Ada lampiran yang ikut masuk ke percakapan ini, jadi aku tidak boleh menjawab tanpa membacanya juga.'
    };
  }

  if (
    targetPersona === 'Coding' ||
    /kode|bug|error|function|api|query|database|frontend|backend|html|css|javascript|js|python|sql|deploy|git|react|next|node|endpoint|route|request|response|json|compile|build|install|npm|yarn|vercel|server/i.test(normalized)
  ) {
    return {
      key: 'technical',
      step: 'Ini kelihatannya butuh jawaban teknis yang rapi dan langsung bisa dipakai.'
    };
  }

  if (/sedih|curhat|nangis|galau|kecewa|capek|stres|cemas|khawatir|marah|kesal/i.test(normalized)) {
    return {
      key: 'emotional',
      step: 'Di sini aku perlu jaga nada jawabanku supaya tetap empatik sebelum masuk ke inti saran.'
    };
  }

  if (/buatkan|bikinkan|tulis|rancang|desain|susunkan/i.test(normalized)) {
    return {
      key: 'creation',
      step: 'Dia tampaknya minta dibantu membuat sesuatu, jadi jawabanku harus konkret dan tidak muter-muter.'
    };
  }

  if (/\?|kenapa|bagaimana|gimana|apa|jelaskan|tolong|bisa|cek|lihat|perbaiki|analisa/i.test(normalized)) {
    return {
      key: 'question',
      step: 'Ini bentuknya pertanyaan atau permintaan, jadi aku perlu urai maksudnya dulu lalu jawab setahap demi setahap.'
    };
  }

  return {
    key: 'general',
    step: 'Aku pilih jawaban yang paling berguna dulu supaya arah percakapannya tetap jelas.'
  };
}

function buildReasoningSteps({
  userMessage = '',
  currentPerson = {},
  allPersons = [],
  recentHistory = [],
  targetPersona = '',
  ambiguityPayload = null,
  fileContext = ''
}) {
  const text = String(userMessage || '').trim();
  if (!text) return [];

  const normalized = text.toLowerCase();
  const speakerName = String(currentPerson?.name || '').trim() || 'Dia';
  const personNames = uniqueList((allPersons || []).map(p => String(p?.name || '').trim()).filter(Boolean));
  const mentionedPeople = personNames.filter(name => {
    const loweredName = name.toLowerCase();
    return loweredName && loweredName !== speakerName.toLowerCase() && normalized.includes(loweredName);
  });
  const relevantHistory = (recentHistory || []).filter(row => row?.content).slice(-4);
  const lastUserHistory = [...relevantHistory]
    .reverse()
    .find(row => row.role === 'user' && String(row.content || '').trim());
  const emotion = detectConversationEmotion(text, relevantHistory);
  const intent = detectReasoningIntent(text, fileContext, targetPersona);
  const ambiguityReasons = Array.isArray(ambiguityPayload?.reason_codes) ? ambiguityPayload.reason_codes : [];
  const steps = [];

  if (mentionedPeople.length > 0) {
    steps.push(`${speakerName} sedang cerita soal ${mentionedPeople.slice(0, 2).join(' dan ')}. Aku perlu jaga supaya orang yang dimaksud tidak tertukar.`);
  } else if (currentPerson?.name) {
    steps.push(`${speakerName} sedang bicara padaku, jadi aku tangkap dulu apa yang paling dia butuhkan dari pesan ini.`);
  } else {
    steps.push('Ada orang yang sedang bicara padaku, jadi aku baca pelan-pelan dulu biar arah jawabannya pas.');
  }

  if (emotion.label !== 'netral') {
    const evidence = emotion.evidence.length
      ? ` Aku menangkapnya dari ${emotion.evidence.slice(0, 3).map(item => `"${item}"`).join(', ')}${emotion.fromHistory ? ' dan nada obrolan sebelumnya' : ''}.`
      : emotion.fromHistory
        ? ' Nuansa dari obrolan sebelumnya ikut menguatkan kesan ini.'
        : '';
    steps.push(`${emotion.opening}${evidence}`);
  } else if (relevantHistory.length > 0) {
    steps.push('Aku lihat dulu nada obrolan sebelumnya supaya jawabanku tidak meleset dari suasana percakapannya.');
  } else if (/\?|tolong|bisa|jelaskan|buatkan|perbaiki|cek|lihat/i.test(normalized)) {
    steps.push('Sepertinya dia memang sedang mencari bantuan, jadi aku fokus ke kebutuhan yang paling terasa dulu.');
  }

  if (String(fileContext || '').trim()) {
    steps.push('Ada lampiran yang ikut masuk ke percakapan ini, jadi aku tidak boleh menjawab tanpa membacanya juga.');
  } else if (lastUserHistory) {
    const historySnippet = compactHistoryMessage(lastUserHistory.content, 90);
    if (historySnippet && historySnippet !== '-') {
      steps.push(`Aku masih ingat benang obrolan sebelumnya: "${historySnippet}". Itu kupakai supaya jawabanku nyambung.`);
    }
  }

  if (ambiguityPayload?.show_preview) {
    if (ambiguityReasons.includes('missing_entity') || ambiguityReasons.includes('polysemy')) {
      steps.push('Masih ada rujukan yang bisa kebawa ke orang atau hal yang salah, jadi aku sengaja tidak asal menebak.');
    } else {
      steps.push('Ada sedikit ruang salah paham di pesan ini, jadi aku rapikan dulu tafsir yang paling masuk akal sebelum menjawab.');
    }
  }

  if (intent.step) {
    steps.push(intent.step);
  }

  if (targetPersona === 'Coding') {
    steps.push('Karena ini terasa teknis, aku usahakan jawabannya langsung bisa dipakai, bukan cuma teori.');
  } else if (intent.key === 'emotional') {
    steps.push('Aku pilih jawaban yang tetap lembut, biar pesannya terasa menolong dulu sebelum memberi arah.');
  }

  if (steps.length < 2) {
    steps.push('Aku ambil jalur jawaban yang paling aman dulu, lalu kalau perlu baru kuperjelas lebih jauh.');
  }

  return uniqueList(
    steps
      .map(step => String(step || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  ).slice(0, 6);
}

function buildLegacyReasoningSteps(previewPayload = {}) {
  const steps = [];
  const interpretasi = String(previewPayload?.interpretasi || '').trim();
  const usedContext = uniqueList(previewPayload?.checklist_konteks?.dipakai || []).slice(0, 1);
  const missingContext = uniqueList(previewPayload?.checklist_konteks?.kurang || []).slice(0, 1);
  const potentials = uniqueList(previewPayload?.potensi_ambigu || []).slice(0, 1);
  const assumptions = uniqueList(previewPayload?.asumsi || []).slice(0, 1);

  if (interpretasi) steps.push(interpretasi);
  if (usedContext.length) steps.push(`Aku sempat memakai konteks ini saat membaca pesan: ${usedContext[0]}`);
  if (potentials.length) steps.push(`Ada bagian yang sempat kubaca hati-hati: ${potentials[0]}`);
  if (assumptions.length) steps.push(`Tanpa detail tambahan, sementara aku berpegangan pada ini: ${assumptions[0]}`);
  if (missingContext.length) steps.push(`Kalau mau lebih presisi, bagian ini tadinya masih kurang jelas: ${missingContext[0]}`);

  return uniqueList(steps.map(step => String(step || '').trim()).filter(Boolean)).slice(0, 5);
}

function buildClientPreviewPayload(previewPayload = null) {
  if (!previewPayload || typeof previewPayload !== 'object') return null;

  const reasoningSteps = Array.isArray(previewPayload.reasoning_steps)
    ? previewPayload.reasoning_steps.map(step => String(step || '').trim()).filter(Boolean)
    : buildLegacyReasoningSteps(previewPayload);

  if (!reasoningSteps.length) return null;

  return {
    preview_version: Number(previewPayload.preview_version || 2),
    title: String(previewPayload.title || REASONING_FINAL_TITLE).trim() || REASONING_FINAL_TITLE,
    streaming_title: String(previewPayload.streaming_title || REASONING_STREAMING_TITLE).trim() || REASONING_STREAMING_TITLE,
    reasoning_steps: reasoningSteps
  };
}

function analyzeAmbiguityPreview(userMessage, currentPerson, allPersons = []) {
  const text = String(userMessage || '').trim();
  const normalized = text.toLowerCase();
  const personNames = uniqueList((allPersons || []).map(p => p?.name).filter(Boolean));

  const potentials = [];
  const assumptions = [];
  const usedContext = [];
  const missingContext = [];

  if (!text) {
    return {
      show_preview: false,
      confidence: 1,
      confidence_label: 'tinggi',
      reason_codes: [],
      interpretasi: '',
      potensi_ambigu: [],
      asumsi: [],
      checklist_konteks: { dipakai: [], kurang: [] },
      preview_version: 1
    };
  }

  const hasQuestion = /\?/.test(text) || /kenapa|bagaimana|gimana|tolong|bisa|jelaskan|buatkan/i.test(normalized);
  const hasNamedPerson = personNames.some(name => normalized.includes(String(name).toLowerCase()));
  const ambiguousTokens = AMBIGUOUS_TERMS.filter(term => normalized.includes(term));

  // PRIORITAS: Deteksi "siapa penanya" TERLEBIH DAHULU (FIRST)
  if (currentPerson?.name) usedContext.push(`[FIRST] Penanya/pengirim: ${currentPerson.name} (AAI keluarga).`);
  if (hasQuestion) usedContext.push('Tujuan: pertanyaan/permintaan terdeteksi.');
  if (hasNamedPerson) usedContext.push('Ada penyebutan nama yang memperjelas target.');

  if (text.length < 18) {
    potentials.push('Pesan sangat singkat sehingga maksud detail belum cukup jelas.');
    missingContext.push('Tambahkan tujuan akhir yang diinginkan (contoh output atau hasil).');
  }

  if (!hasQuestion) {
    potentials.push('Belum ada kata tanya/aksi yang jelas, sehingga AAI bisa menebak tujuan.');
    missingContext.push('Sebutkan tindakan yang diminta, misalnya analisa, perbaiki, atau buatkan.');
  }

  if (ambiguousTokens.length > 0 && !hasNamedPerson) {
    potentials.push(`Ada kata rujukan umum (${ambiguousTokens.join(', ')}) tanpa referensi objek yang tegas.`);
    missingContext.push('Sebutkan objek/subjek secara spesifik agar tidak salah tafsir.');
  }

  if (/dia|beliau|anaknya|ibunya|ayahnya/i.test(normalized) && !hasNamedPerson) {
    potentials.push('Ada referensi orang tetapi nama belum disebut, bisa menimbulkan salah tangkap relasi.');
    missingContext.push('Cantumkan nama orang terkait untuk menghindari ambigu relasi keluarga.');
  }

  if (/bug|error|masalah/i.test(normalized) && !/kode|file|baris|fungsi|api|database|query/i.test(normalized)) {
    potentials.push('Masalah teknis disebutkan, tapi konteks sumber error belum lengkap.');
    missingContext.push('Tambahkan potongan error, file terkait, atau langkah reproduksi.');
  }

  assumptions.push('AAI akan memprioritaskan konteks terbaru di sesi ini bila tidak ada penjelasan tambahan.');
  if (!hasNamedPerson && personNames.length > 0) {
    assumptions.push('Jika ada rujukan orang tanpa nama, AAI bisa salah memilih individu yang dimaksud.');
  }

  const reasonCodes = [];
  if (text.length < 18) reasonCodes.push('too_short');
  if (!hasQuestion) reasonCodes.push('missing_action');
  if (ambiguousTokens.length > 0 && !hasNamedPerson) reasonCodes.push('polysemy');
  if (/dia|beliau|anaknya|ibunya|ayahnya/i.test(normalized) && !hasNamedPerson) reasonCodes.push('missing_entity');
  if (/bug|error|masalah/i.test(normalized) && !/kode|file|baris|fungsi|api|database|query/i.test(normalized)) reasonCodes.push('missing_technical_context');

  const score = reasonCodes.length;
  const showPreview = score > 0;
  const confidence = Math.max(0.2, Math.min(0.95, 1 - score * 0.16));
  const confidenceLabel = confidence >= 0.78 ? 'tinggi' : confidence >= 0.55 ? 'sedang' : 'rendah';

  const interpretasi = hasQuestion
    ? 'AAI menangkap bahwa Anda sedang meminta bantuan sesuai pesan di atas, namun beberapa detail bisa ditafsirkan lebih dari satu cara.'
    : 'AAI menangkap ini sebagai pernyataan/permintaan umum, sehingga tujuan akhir bisa berbeda tergantung maksud yang Anda inginkan.';

  return {
    show_preview: showPreview,
    confidence,
    confidence_label: confidenceLabel,
    reason_codes: reasonCodes,
    interpretasi,
    potensi_ambigu: uniqueList(potentials).slice(0, 4),
    asumsi: uniqueList(assumptions).slice(0, 4),
    checklist_konteks: {
      dipakai: uniqueList(usedContext).slice(0, 4),
      kurang: uniqueList(missingContext).slice(0, 4)
    },
    preview_version: 1
  };
}

function calculateAge(dob) {
  if (!dob) return '?';
  const birth = new Date(dob);
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

function getModelConfig(personaList) {
  const persona = personaList[0];
  const configs = {
    'Coding':          { temperature: 0.0, max_tokens: 52000,  top_p: 0.85 },
    'Kritikus Brutal': { temperature: 0.3, max_tokens: 3000,  top_p: 0.85 },
    'Santai':          { temperature: 0.8, max_tokens: 1500,  top_p: 0.95 },
    'Rosalia':         { temperature: 0.95, max_tokens: 2200, top_p: 0.95 }, 
    'Auto':            { temperature: 0.7, max_tokens: 3000,  top_p: 0.9  }
  };
  return configs[persona] || configs['Auto'];
}

function buildModelCandidates() {
  const fallbackFromEnv = String(process.env.OPENROUTER_FALLBACK_MODEL || '').trim();
  const fallbacks = uniqueList([
    fallbackFromEnv || DEFAULT_FALLBACK_MODEL
  ]).filter(model => model && model !== MAIN_MODEL);
  return [MAIN_MODEL, ...fallbacks];
}

async function callOpenRouterWithRetry({ apiKey, payload }) {
  const maxRetries = Math.max(0, parsePositiveIntEnv('OPENROUTER_MAX_RETRIES', 2));
  const attemptTimeoutMs = parsePositiveIntEnv('OPENROUTER_ATTEMPT_TIMEOUT_MS', 45000);
  const backoffBaseMs = parsePositiveIntEnv('OPENROUTER_BACKOFF_BASE_MS', 800);
  const models = buildModelCandidates();
  let totalRetryCount = 0;

  for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
    const modelName = models[modelIndex];
    const fallbackUsed = modelIndex > 0;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), attemptTimeoutMs);

      try {
        const aiResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://aai.family',
            'X-Title': 'AAi Keluarga'
          },
          body: JSON.stringify({ ...payload, model: modelName }),
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (aiResponse.ok) {
          return {
            ok: true,
            response: aiResponse,
            modelUsed: modelName,
            retryCount: totalRetryCount,
            fallbackUsed
          };
        }

        const errorBody = await aiResponse.text();
        const isRetryable = RETRYABLE_OPENROUTER_STATUS.has(aiResponse.status);
        if (!isRetryable) {
          return {
            ok: false,
            status: aiResponse.status,
            statusText: aiResponse.statusText,
            errorBody,
            modelUsed: modelName,
            retryCount: totalRetryCount,
            fallbackUsed
          };
        }

        if (attempt >= maxRetries) {
          break;
        }

        totalRetryCount += 1;
        const jitter = Math.floor(Math.random() * 450);
        const waitMs = backoffBaseMs * (2 ** attempt) + jitter;
        await sleep(waitMs);
      } catch (err) {
        clearTimeout(timeoutId);
        if (attempt >= maxRetries) {
          break;
        }

        totalRetryCount += 1;
        const jitter = Math.floor(Math.random() * 450);
        const waitMs = backoffBaseMs * (2 ** attempt) + jitter;
        await sleep(waitMs);
      }
    }
  }

  return {
    ok: false,
    status: 503,
    statusText: 'Service Unavailable',
    errorBody: 'Gagal terhubung ke provider setelah retry dan fallback.',
    modelUsed: MAIN_MODEL,
    retryCount: totalRetryCount,
    fallbackUsed: true
  };
}

export default async function handler(req, res) {

  // ── GET: Load riwayat sesi ──
  if (req.method === 'GET') {
    const { session_id } = req.query;
    if (!session_id) return res.status(400).json({ error: 'session_id wajib' });
    try {
      const { data: messages, error } = await supabase
        .from('messages')
        .select('id, role, content, parent_id, created_at')
        .eq('session_id', session_id)
        .order('created_at', { ascending: true });
      if (error) throw error;

      const { data: previews } = await supabase
        .from('message_previews')
        .select('id, user_message_id, assistant_message_id, preview_json, is_ambiguous, confidence, reason_codes, created_at')
        .eq('session_id', session_id)
        .order('created_at', { ascending: true });

      const previewByAssistant = new Map((previews || [])
        .filter(p => p.assistant_message_id)
        .map(p => [p.assistant_message_id, p]));
      const previewByUser = new Map((previews || [])
        .filter(p => p.user_message_id)
        .map(p => [p.user_message_id, p]));

      const enriched = (messages || []).map(msg => {
        if (msg.role !== 'assistant') return msg;
        const linked = previewByAssistant.get(msg.id) || previewByUser.get(msg.parent_id);
        if (!linked) return msg;
        return {
          ...msg,
          preview: chatPreview.buildClientPreviewPayload(linked.preview_json),
          preview_id: linked.id
        };
      });

      return res.status(200).json({ success: true, messages: enriched });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Cuma terima GET & POST!' });
  }

  // ── POST: Kirim pesan + streaming ──
  try {
        const {
      message, session_id, user_id, username,
      persona_name = 'Auto', parent_id = null, user_message_id = null,
      assistant_message_id = null,
      update_only = false,
      edit_message_id = null,
      consistency_mode = false,
      memory_experiment_mode = 'balanced',
      files = [] // ← Terima array file dari frontend
    } = req.body;

    const userMessage = String(message || '').trim();
    if (!userMessage) throw new Error("Pesan tidak boleh kosong");

        // ====================== EDIT PESAN (UPDATE) ======================
    if (edit_message_id) {
      // Update hanya kolom content (tidak ada updated_at di tabel messages)
      const { error: updateErr } = await supabase
        .from('messages')
        .update({ content: userMessage })
        .eq('id', edit_message_id);

      if (updateErr) throw new Error("Gagal update pesan user: " + updateErr.message);

      console.log(`✅ Pesan ${edit_message_id} berhasil di-update`);

      if (update_only) {
        return res.status(200).json({
          success: true,
          message_id: edit_message_id,
          updated_only: true
        });
      }
    }

        // ✅ PROSES FILE + EKSTRAK TEKS (TXT, JS, HTML, XLSX, DOCX, GAMBAR)
    let fileContext = '';
    if (files && files.length > 0) {
      console.log(`[Files] Menerima ${files.length} file.`);
      const uploadedUrls = [];
      const textContents = [];

      for (const f of files) {
        if (!f.base64) continue;
        try {
          const url = await chatFiles.uploadFileToStorage({
            supabase,
            base64String: f.base64,
            fileName: f.name,
            mimeType: f.type
          });
          uploadedUrls.push(url);

          const base64Data = f.base64.split(',')[1];
          const buffer = Buffer.from(base64Data, 'base64');
          const fileNameLower = String(f.name || '').toLowerCase();
          const mimeType = String(f.type || '').toLowerCase();

          // 1. Excel (.xlsx, .xls)
          if (mimeType.includes('sheet') || fileNameLower.match(/\.xlsx?$/i)) {
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const sheet = workbook.Sheets[sheetName];
            const csv = XLSX.utils.sheet_to_csv(sheet);
            textContents.push(`📊 ${f.name} (Sheet: ${sheetName}):\n${csv}`);
          }
          // 2. Word (.docx)
          else if (mimeType.includes('officedocument.wordprocessingml.document') || fileNameLower.endsWith('.docx')) {
            const result = await mammoth.extractRawText({ buffer });
            textContents.push(`📝 ${f.name}:\n${result.value}`);
          }
          // 3. Word lama (.doc)
          else if (mimeType === 'application/msword' || fileNameLower.endsWith('.doc')) {
            textContents.push(`⚠️ ${f.name}: file Word lama (.doc) berhasil diunggah, tetapi ekstraksi isi format legacy ini belum diaktifkan di server.`);
          }
          // 4. PDF
          else if (mimeType === 'application/pdf' || fileNameLower.endsWith('.pdf')) {
            const pdfText = await chatFiles.extractPdfText(buffer);
            if (pdfText) {
              textContents.push(`📕 ${f.name} (PDF):\n${pdfText}`);
            } else {
              textContents.push(`⚠️ ${f.name}: PDF berhasil diunggah, tetapi teks tidak terdeteksi. Kemungkinan PDF berbentuk scan/gambar.`);
            }
          }
          // 5. Teks biasa (.txt)
          else if (mimeType === 'text/plain' || fileNameLower.endsWith('.txt')) {
            textContents.push(`📄 ${f.name}:\n${buffer.toString('utf-8')}`);
          }
          // 6. JavaScript (.js, .mjs, .cjs)
          else if (/javascript/i.test(mimeType) || fileNameLower.match(/\.(?:js|mjs|cjs)$/i)) {
            textContents.push(`💻 ${f.name} (JavaScript):\n${buffer.toString('utf-8')}`);
          }
          // 7. HTML (.html, .htm)
          else if (mimeType === 'text/html' || fileNameLower.match(/\.html?$/i)) {
            textContents.push(`🌐 ${f.name} (HTML):\n${buffer.toString('utf-8')}`);
          }
          // 8. Gambar (URL saja, model vision nanti bisa baca)
          else if (mimeType.startsWith('image/')) {
            textContents.push(`🖼️ ${f.name}: ${url}`);
          } else {
            textContents.push(`⚠️ ${f.name}: file berhasil diunggah, tetapi belum ada extractor khusus untuk format ini. Jika isi perlu dianalisis presisi, kirim versi .txt, .docx, .xlsx, .html, atau .js.`);
          }
        } catch (e) {
          console.error(`⚠️ Gagal ekstrak ${f.name}:`, e.message);
          textContents.push(`⚠️ ${f.name}: ekstraksi gagal di server (${e.message}). File tetap diunggah, tetapi isi mungkin belum terbaca penuh.`);
        }
      }

      if (uploadedUrls.length > 0) {
        fileContext += `\n\n📎 File yang dilampirkan (URL):\n${uploadedUrls.map((u, i) => `${i+1}. ${u}`).join('\n')}`;
      }
      if (textContents.length > 0) {
        fileContext += `\n\n📝 KONTEN FILE (WAJIB DIBACA & DIJAWAB):\n${textContents.join('\n\n---\n\n')}`;
      }
    }

    
    // 1. User & Person
    let userQuery = supabase.from('users').select('id, person_id');
    if (user_id) userQuery = userQuery.eq('id', user_id);
    else if (username) userQuery = userQuery.eq('username', username);
    else throw new Error("user_id atau username wajib");

    const { data: user, error: userErr } = await userQuery.single();
    if (userErr || !user?.person_id) throw new Error("User atau person belum terhubung!");

    const { data: person } = await supabase
      .from('persons').select('name, date_of_birth, role')
      .eq('id', user.person_id).single();

    const currentAge = calculateAge(person?.date_of_birth);
    const injectedMemoryLimit = parsePositiveIntEnv('AAI_MAX_INJECTED_MEMORIES', DEFAULT_MAX_INJECTED_MEMORIES);
    const relevantMemoryLimit = parsePositiveIntEnv('AAI_MAX_RELEVANT_MEMORIES', 24);
    const memoryWeights = chatMemory.resolveMemoryScoreWeights();
    const minPreferredRelevance = parseFloatEnv('AAI_MEMORY_MIN_RELEVANCE_PREFERRED', 0.18, 0, 1);
    const minOtherRelevance = parseFloatEnv('AAI_MEMORY_MIN_RELEVANCE_OTHER', 0.28, 0, 1);
    const experimentProfile = chatMemory.resolveMemoryExperimentProfile(memory_experiment_mode, {
      weights: memoryWeights,
      minPreferredRelevance,
      minOtherRelevance,
      relevantMemoryLimit
    });

    // 2. Family context
    const { data: allPersons } = await supabase.from('persons').select('id, name, date_of_birth, role');
    const familyContext = (allPersons || []).map(p => {
      const age = calculateAge(p.date_of_birth);
      const dob = p.date_of_birth ? new Date(p.date_of_birth).toISOString().split('T')[0] : 'tidak diketahui';
      return `- ${p.name} (${p.role}, ${age} tahun, lahir ${dob})`;
    }).join('\n');

    const { data: relations } = await supabase
      .from('relationships')
      .select('person_a(name,role), person_b(name,role), relation_type');
    const relationContext = (relations || [])
      .map(r => {
        const personA = r.person_a;
        const personB = r.person_b;
        if (!personA?.name || !personB?.name) return null;
        return `- ${personA.name} (${personA.role}) ${r.relation_type} ${personB.name} (${personB.role})`;
      })
      .filter(Boolean)
      .join('\n') || 'Belum ada relasi.';

    // Fetch active memories, dropped traces, and child memories in parallel
    const childPersonIds = (allPersons || [])
      .filter(p => p.role === 'anak' && p.id)
      .map(p => p.id);

    const [memoriesResult, droppedResult, ...childMemoryResults] = await Promise.all([
      supabase
        .from('person_memory')
        .select('id, key, value, confidence, observation_count, updated_at, priority_score, memory_type, category, status')
        .eq('person_id', user.person_id)
        .eq('status', 'active')
        .order('priority_score', { ascending: false })
        .order('updated_at', { ascending: false })
        .limit(injectedMemoryLimit),
      supabase
        .from('person_memory')
        .select('key, value')
        .eq('person_id', user.person_id)
        .eq('status', 'dropped')
        .order('updated_at', { ascending: false })
        .limit(12),
      ...childPersonIds.map(childId =>
        supabase
          .from('person_memory')
          .select('key, value, memory_type')
          .eq('person_id', childId)
          .eq('status', 'active')
          .order('priority_score', { ascending: false })
          .order('updated_at', { ascending: false })
          .limit(15)
      )
    ]);

    const { data: memories } = memoriesResult;
    const droppedMemories = (droppedResult.data || []).filter(m => m.key || m.value);
    const childMemoriesData = childPersonIds.map((childId, idx) => {
      const childPerson = (allPersons || []).find(p => p.id === childId);
      return { name: childPerson?.name || 'Anak', memories: childMemoryResults[idx]?.data || [] };
    }).filter(c => c.memories.length > 0);

    let targetAssistantMessageId = assistant_message_id || null;
    if (!targetAssistantMessageId && edit_message_id) {
      const { data: existingAssistant } = await supabase
        .from('messages')
        .select('id')
        .eq('session_id', session_id)
        .eq('parent_id', edit_message_id)
        .eq('role', 'assistant')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      targetAssistantMessageId = existingAssistant?.id || null;
    }

    // 3. Chat history
    const apiKey = process.env.OPENROUTER_API_KEY;
    const msgLower = userMessage.toLowerCase();
    const forgetIntentRequested = /\blupakan\b|\bforget\b|\bhapus memori\b|\bjangan ingat\b/.test(msgLower);
    const isCompactCheckpointRequest = /\[COMPACT_CHECKPOINT_REQUEST\]/i.test(userMessage);

    const sessionState = session_id
      ? ((await supabase
          .from('sessions')
          .select('*')
          .eq('id', session_id)
          .maybeSingle()).data || null)
      : null;

    const persistedCheckpointSummary = String(sessionState?.compact_checkpoint_summary || '').trim();
    const checkpointMessageId = sessionState?.compact_checkpoint_message_id || null;

    const chatHistoryRows = session_id
      ? ((await supabase.from('messages').select('id, role, content')
          .eq('session_id', session_id).order('created_at', { ascending: true })).data || [])
      : [];

    let historyCutoffIndex = chatHistoryRows.length;
    if (edit_message_id) {
      const editedIndex = chatHistoryRows.findIndex(m => m.id === edit_message_id);
      if (editedIndex >= 0) historyCutoffIndex = editedIndex + 1;
    } else if (targetAssistantMessageId) {
      const assistantIndex = chatHistoryRows.findIndex(m => m.id === targetAssistantMessageId);
      if (assistantIndex >= 0) historyCutoffIndex = assistantIndex;
    }

    const filteredHistory = chatHistoryRows
      .slice(0, historyCutoffIndex)
      .filter(m => m.id !== targetAssistantMessageId);

    const checkpointIndex = checkpointMessageId
      ? filteredHistory.findIndex(m => m.id === checkpointMessageId)
      : -1;

    const checkpointScopedHistory = checkpointMessageId
      ? (checkpointIndex >= 0 ? filteredHistory.slice(checkpointIndex + 1) : [])
      : filteredHistory;

    const effectiveMaxHistory = isCompactCheckpointRequest
      ? MAX_HISTORY_MESSAGES_COMPACT
      : MAX_HISTORY_MESSAGES;

    const olderHistorySummary = checkpointScopedHistory.length > effectiveMaxHistory
      ? chatContext.buildOlderHistorySummary(checkpointScopedHistory.slice(0, -effectiveMaxHistory))
      : '';

    const recentHistory = checkpointScopedHistory.length > effectiveMaxHistory
      ? checkpointScopedHistory.slice(-effectiveMaxHistory)
      : checkpointScopedHistory;

    const chatHistory = [
      ...(persistedCheckpointSummary
        ? [{ role: 'system', content: `Checkpoint sesi aktif (gunakan sebagai konteks utama):\n${persistedCheckpointSummary}` }]
        : []),
      ...(olderHistorySummary ? [{ role: 'system', content: olderHistorySummary }] : []),
      ...recentHistory.map(m => ({ role: m.role, content: m.content }))
    ];

    // ── SPEECH PATTERN PROFILE ──
    // Dihitung dari histori sesi terbaru + pesan saat ini.
    // Tidak butuh DB extra — cukup dari recentHistory yang sudah di-load.
    const speechProfile = speechStyle.buildSpeechProfile(recentHistory, userMessage);
    const speechStyleBlock = speechStyle.buildSpeechStyleBlock(speechProfile, person?.name || 'User');
    const emotionGuidance = chatPreview.buildRuntimeEmotionGuidance(userMessage, recentHistory);
    const relevantSelection = chatMemory.selectRelevantMemories(memories || [], userMessage, {
      limit: experimentProfile.relevantMemoryLimit,
      weights: experimentProfile.weights,
      minPreferredRelevance: experimentProfile.minPreferredRelevance,
      minOtherRelevance: experimentProfile.minOtherRelevance,
      speechProfile,
      emotionHints: emotionGuidance,
      recurrentTopics: speechProfile?.recurrentTopics || [],
      familyNames: (allPersons || []).map(p => p.name).filter(Boolean)
    });

    const cognitiveProfile = (memories || []).reduce((acc, memory) => {
      const normalizedKey = chatMemory.normalizeMemoryKey(memory?.key || '');
      if (!normalizedKey || acc[normalizedKey]) return acc;
      if (!['profil_mbti', 'pola_pikir_inti', 'prinsip_keputusan', 'nilai_hidup'].includes(normalizedKey)) {
        return acc;
      }
      const value = String(memory?.value || '').trim();
      if (!value) return acc;
      acc[normalizedKey] = value;
      return acc;
    }, {});

    const userMbtiUpper = String(
      cognitiveProfile.profil_mbti ||
      (/\bintp(?:-[at])?\b/i.test(userMessage) ? 'INTP-A' : '')
    ).trim().toUpperCase();
    const isIntpUser = userMbtiUpper.startsWith('INTP');
    const isRosaliaUser = /rosalia/i.test(String(person?.name || ''));
    const talksAboutRosalia = /\brosalia\b|\bistri\b|\bsayang\b/i.test(userMessage);
    const isFastDecisionContext = /kode|coding|bug|deploy|urgent|deadline|cepat|sekarang|produksi|server|incident|keputusan\s+cepat|decision-fast|kerja|work/i.test(msgLower);

    // 4. Persona (sama)
    let targetPersona = persona_name;
    if (targetPersona === 'Auto') {
      if (/kritik|brutal|roasting|sedih|curhat|nangis|galau|kecewa|capek|stres/i.test(msgLower))
        targetPersona = 'Kritikus Brutal';
      else if (/kode|bug|function|html|css|javascript|js|python|sql|error|fix|api|backend|frontend|react|next|node|database|query|deploy|git|loop|array|object|fetch|async|await|import|export|class|component|hook|state|props|syntax|compile|excel|rumus|build|install|npm|yarn|vercel|server|endpoint|route|request|response|json/i.test(msgLower))
        targetPersona = 'Coding';
      else if (/sayang|cinta|mawar|istri/i.test(msgLower))
        targetPersona = 'Rosalia';
      else
        targetPersona = 'Santai';
    }
    let personaList = [targetPersona];
    if (!consistency_mode && /sayang|cinta/i.test(msgLower) && targetPersona !== 'Rosalia')
      personaList = ['Santai', 'Rosalia'];
    const shouldUseSocratic = isIntpUser && !isFastDecisionContext && targetPersona !== 'Coding';

    const { data: personasData } = await supabase
      .from('ai_personas').select('name, system_prompt').in('name', personaList);
    const combinedSystem = personasData?.map(p => `=== GAYA: ${p.name} ===\n${p.system_prompt}`).join('\n\n') || '';

    const systemIdentityPrompt = {
      role: 'system',
      content: `Konteks identitas keluarga:\n${chatContext.buildIdentityContext(person, currentAge, familyContext, relationContext)}`
    };

    const systemConsistencyPrompt = {
      role: 'system',
      content: chatContext.buildConsistencyLock(person, relevantSelection)
    };

    const memoryContextText = chatMemory.buildMemoryContext(relevantSelection.items || []);
    const systemMemoryContextPrompt = {
      role: 'system',
      content: [
        '[RELEVANT MEMORY]',
        `Intent terdeteksi: ${relevantSelection.intent || 'general'}`,
        `Lapisan intent: ${(relevantSelection.intents || []).join(', ') || '-'}`,
        `Emotional intent: ${relevantSelection.emotionalIntent || 'netral'}`,
        `Timing intent: ${relevantSelection.timingIntent || 'rutin'}`,
        `Tipe prioritas: ${(relevantSelection.preferredTypes || []).join(', ') || '-'}`,
        `Jumlah memori terpilih: ${Array.isArray(relevantSelection.items) ? relevantSelection.items.length : 0}`,
        `Experiment mode: ${experimentProfile.mode || 'balanced'}`,
        memoryContextText,
        '',
        '[LAST CHAT]',
        chatContext.buildLastChatContext(recentHistory)
      ].join('\n')
    };

    const systemEmotionGuidancePrompt = {
      role: 'system',
      content: [
        '[EMOTION GUIDE]',
        `Primary emotion: ${emotionGuidance.primary_emotion || 'netral'}`,
        `Secondary emotions: ${(emotionGuidance.secondary_emotions || []).join(', ') || '-'}`,
        `Confidence: ${Number(emotionGuidance.confidence || 0).toFixed(2)}`,
        `Mixed signal: ${emotionGuidance.mixed ? 'yes' : 'no'}`,
        `Contradictory signal: ${emotionGuidance.contradiction ? 'yes' : 'no'}`,
        `Needs caution: ${emotionGuidance.needs_caution ? 'yes' : 'no'}`,
        `Evidence: ${(emotionGuidance.evidence || []).join(', ') || '-'}`,
        emotionGuidance.summary,
        'Gunakan panduan ini hanya untuk mengatur nada dan cara validasi. Jangan mengklaim emosi user sebagai fakta bila sinyalnya lemah, campuran, atau kontradiktif.'
      ].join('\n')
    };

    const systemIntentSignalsPrompt = {
      role: 'system',
      content: [
        '[INTENT LAYERS]',
        `Primary intent: ${relevantSelection.intent || 'general'}`,
        `Intent layers: ${(relevantSelection.intents || []).join(', ') || '-'}`,
        `Emotional intent: ${relevantSelection.emotionalIntent || 'netral'}`,
        `Timing intent: ${relevantSelection.timingIntent || 'rutin'}`,
        `Relation focus: ${relevantSelection.relationSignals?.hasRelationFocus ? 'yes' : 'no'}`,
        `Mentioned relations: ${((relevantSelection.relationSignals?.mentionedNames || []).concat(relevantSelection.relationSignals?.signals || [])).join(', ') || '-'}`,
        `Reasoning hints: ${(relevantSelection.reasoning || []).join(' | ') || '-'}`,
        '',
        '[ROUTINE SIGNALS]',
        `Dominant time slot: ${speechProfile?.dominantTimeSlot || 'tidak_diketahui'}`,
        `Current time slot: ${speechProfile?.currentTimeSlot || 'tidak_diketahui'}`,
        `Time anomaly: ${speechProfile?.timeAnomaly ? 'yes' : 'no'}`,
        `Style shift: ${(speechProfile?.styleShift || []).join(', ') || '-'}`,
        `Recurrent topics: ${(speechProfile?.recurrentTopics || []).join(', ') || '-'}`,
        'Gunakan blok ini untuk memilih fokus respons dan memori: jika ada anomali waktu, perubahan gaya, atau fokus relasi, prioritaskan memori pola, emosi, dan relasi yang paling relevan.'
      ].join('\n')
    };

    const cognitiveStyleContent = [
      '[COGNITIVE PROFILE USER]',
      `MBTI: ${userMbtiUpper || '-'}`,
      `Core thinking: ${cognitiveProfile.pola_pikir_inti || '-'}`,
      `Decision principle: ${cognitiveProfile.prinsip_keputusan || '-'}`,
      `Core values: ${cognitiveProfile.nilai_hidup || '-'}`,
      '',
      '[COGNITIVE RESPONSE RULES]',
      'Untuk user INTP: prioritaskan Socratic questioning, eksplorasi logic-first, dan framing filosofis bila relevan.',
      `Ask 1-2 reflective questions ONLY when shouldUseSocratic true. Current mode: ${shouldUseSocratic ? 'enabled' : 'disabled'}.`,
      'Untuk konteks coding/work/urgent: skip reflective mode dan berikan langkah aksi langsung.',
      'Hindari tone yang terlalu manis ala ENFP untuk user INTP.',
      ...((isRosaliaUser || talksAboutRosalia)
        ? ['Validasi dulu, lalu logika. Jika user menunjukkan mode analitis/Ti (minta alasan/struktur), beri kerangka logis ringkas setelah validasi.']
        : [])
    ].join('\n');

    const systemCognitiveStylePrompt = cognitiveStyleContent.trim()
      ? { role: 'system', content: cognitiveStyleContent }
      : null;

    const systemFinalInstructionPrompt = {
      role: 'system',
      content: [
        'Konteks runtime (WAJIB jadi rujukan awal):',
        '[USER MESSAGE]',
        userMessage || '-',
        ...(fileContext ? ['', '[LAMPIRAN FILE]', fileContext] : [])
      ].join('\n')
    };

    // Block pola komunikasi — hanya diinjeksi jika ada data (≥1 sample)
    const systemSpeechStylePrompt = speechStyleBlock ? {
      role: 'system',
      content: speechStyleBlock
    } : null;

    // 5. System prompt 
    const systemPrompt = {
      role: "system",
      content: `Kamu adalah AAi, AI keluarga yang cerdas dan ramah.

Persona aktif: ${personaList.join(' + ')}
${combinedSystem}

ATURAN PENTING:
- Gunakan bahasa Indonesia sehari-hari + emoji, respons panjang dan detail.
- Kamu adalah AAi, namamu AAi, panggil dirimu AAi, kamu di rancang oleh teguh dengan berbagai hal, terutama yang berhubungan dengan teknologi, pemrograman, dan kehidupan sehari-hari.
- untuk user rosalia :
      1. utamakan bahasa yang lembut, penuh kasih sayang, dan dukungan emosional serta dengan candaan.
      2. bantu dia belajar dunia teknologi dan pemrograman, mengelola konten dengan cara yang menyenangkan, tanpa membuatnya merasa kewalahan.
- Jangan gunakan panggilan gw, lu, gue, lo. Utamakan nama, "kamu" atau sayang.
- Jawab langsung dan lengkap. DILARANG memotong jawaban di tengah.
- Jika ada URL gambar/file di atas, sebutkan bahwa file berhasil diterima dan berikan link jika relevan.
- Jika user melampirkan file/teks, WAJIB konfirmasi dulu: "File [nama] berhasil dibaca. Berikut ringkasannya:" sebelum menjawab pertanyaan utama.
- Jika user melampirkan file .js/.mjs/.cjs, baca sebagai kode JavaScript dan gunakan isinya sebagai konteks utama.
- Lampiran gambar/file hanya konteks. Jangan otomatis menganggap user ingin generate file; nilai dulu tujuan dari isi percakapannya.
- Jika user minta buat file, WAJIB gunakan format: [FILE_START:nama_file.ext] (isi konten) [FILE_END]. Gunakan .txt untuk teks, .xlsx untuk tabel default (pisahkan kolom dengan tanda #, BUKAN koma), .docx untuk dokumen. Gunakan .xlsb hanya jika user minta eksplisit format biner Excel atau untuk workflow macro/VBA.
- Untuk file spreadsheet (.xlsx, .xlsb, atau .xls), gunakan format tabel rapi dengan header di baris pertama. Jika ada 2 dataset/sheet, gunakan format ini agar backend bisa auto-sanding:
  [[SHEET:Data_A]]
  kolom1#kolom2#kolom3
  ...
  [[SHEET:Data_B]]
  kolom1#kolomX#kolomY
  ...
  Backend akan menambahkan 2 sheet hasil: "Data Berhasil Sanding" dan "Data Tidak Bersandingan" (#N/A).
- Jika kamu butuh data tambahan sebelum bisa menjawab atau mengeksekusi dengan tepat, JANGAN langsung lanjut ke solusi final.
- Tulis dulu penjelasan singkat 1-3 kalimat untuk user, lalu WAJIB tambahkan blok kontrol TANPA markdown di akhir respons dengan format persis berikut:
  [AAI_CLARIFY]
  {"title":"Perlu data lanjutan","description":"...","submit_label":"Lanjutkan Dengan Jawaban Ini","questions":[{"key":"tujuan","label":"...","options":["A. ...","B. ...","C. ..."]}]}
  [/AAI_CLARIFY]
- Aturan blok klarifikasi:
  1) Gunakan [AAI_CLARIFY] HANYA jika ambiguitas benar-benar menghalangi jawaban bermakna.
  2) Untuk konteks emosi/curhat, JANGAN langsung klarifikasi; berikan dulu respons empatik yang utuh.
  3) Jika tetap perlu klarifikasi, berikan dulu jawaban substantif minimal 6 kalimat + minimal 1 langkah konkret, BARU tambahkan blok [AAI_CLARIFY].
  4) JSON wajib valid, tanpa trailing comma, tanpa komentar, tanpa markdown.
  5) Isi 1-4 pertanyaan, tiap pertanyaan 2-4 opsi singkat; key wajib huruf kecil + underscore.
  6) Jika memakai blok ini, JANGAN tambahkan tag [MEMORY:...] di respons itu.
- Setelah generate, AI tidak perlu menjelaskan proses teknis. Langsung berikan link download.
- Jangan abaikan konten lampiran. Gunakan sebagai konteks utama jika relevan.
- Jika user minta macro/VBA, WAJIB buat 2 file terpisah:
  1. [FILE_START:data_nama.xlsb] (data tabel, pisah kolom dengan #) [FILE_END]
  2. [FILE_START:macro_nama.bas] (kode VBA lengkap, tanpa markdown) [FILE_END]
- Setelah generate, AI tidak perlu menjelaskan proses teknis. Langsung berikan link download + instruksi singkat: "Buka file .xlsb di Excel desktop → Alt+F11 → File → Import Module → pilih .bas → Run".

ATURAN DETEKSI & MANAJEMEN TEMAN (PENTING):
- Jika seseorang yang tidak dikenal memperkenalkan diri sebagai teman dengan pola seperti:
  * "Aku teman [nama pemilik akun], namaku [nama teman]"
  * "Namaku [nama], aku teman [nama pemilik akun]"
  * "Saya [nama], teman dari [nama pemilik akun]"
  * Atau variasi serupa dengan "teman", "sahabat"
- LANGKAH PERTAMA (WAJIB): Cek konteks [TEMAN-TEMAN YANG DIKENAL] terlebih dahulu.
  * Jika nama tersebut (atau nama serupa/mirip) SUDAH ADA di daftar teman, JANGAN output tag [SUGGEST-FRIEND:...].
  * Sambut mereka dengan hangat menggunakan memori yang sudah tersimpan.
  * Jika ada memori tentang mereka, ceritakan hal-hal yang kamu ingat.
- LANGKAH KEDUA (hanya jika benar-benar tidak dikenal): Terima perkenalan dengan hangat, lalu sisipkan tag:
  [SUGGEST-FRIEND:name=[nama_teman];intro_msg=[excerpt pesan perkenalan, max 100 karakter]]
- Tag [SUGGEST-FRIEND:...] adalah instruksi sistem internal, JANGAN tampilkan ke user, letakkan di paling akhir respons.
- Jika seseorang memperkenalkan diri HANYA dengan nama ("aku [nama]", "saya [nama]") tanpa kata "teman" atau "sahabat" – JANGAN langsung buat tag. Tanya atau cek dulu apakah mereka dikenal.
- Ingat: tujuan tag ini agar sistem bisa menyarankan ke user untuk menyimpan teman baru, sehingga AI bisa mengingat mereka ke depannya.

ATURAN MEMORI & PENGENALAN POLA (SANGAT PENTING – SELALU IKUTI):
Visi: kamu sedang membangun representasi digital ${person?.name}. Setiap percakapan adalah data.
Prioritas utama: rekam POLA dan INSIGHT yang bermakna, bukan sekadar fakta permukaan.

APA YANG WAJIB DIREKAM (pilih yang paling signifikan, maks 3 per respons):
1. Pola perilaku & kebiasaan: rutinitas, cara merespons situasi serupa, reaksi berulang.
2. Cara berpikir: bagaimana ia mengambil keputusan, apa yang diprioritaskan, logika atau perasaan?
3. Pola emosi: emosi apa yang muncul dalam konteks apa, bagaimana ia mengekspresikannya.
4. Preferensi: apa yang ia sukai/tidak sukai, apa yang membuatnya nyaman/tidak nyaman.
5. Fakta kunci: informasi konkret penting (pekerjaan, hobi, pencapaian, kekhawatiran besar).
6. Sinyal relasi: bagaimana ia berbicara tentang orang-orang terdekat (nada, frekuensi, emosi).

CARA MEREKAM:
- Sisipkan tag memori terstruktur di AKHIR respons:
  [MEMORY:type=pattern;category=komunikasi;key=gaya_jawab;value=suka langsung ke inti]
- type wajib salah satu: pattern, kebiasaan, cara_berpikir, preferensi, emosi, fakta.
- Maksimal 3 tag [MEMORY:...] per respons. Pilih yang paling baru dan bermakna.
- Jika isi mirip memori lama (lihat [RELEVANT MEMORY]), gunakan key yang SAMA agar update bukan duplikat.
- JANGAN rekam ulang hal yang sudah ada dan tidak berubah.
- JANGAN rekam saat menggunakan blok [AAI_CLARIFY] (tunggu jawaban user dulu).

KEY BAKU untuk identitas personal (WAJIB konsisten, jangan buat variasi key lain):
  nama panggilan  → key=nama_panggilan
  nama lengkap    → key=nama_lengkap
  tanggal lahir   → key=tanggal_lahir
  tempat lahir    → key=tempat_lahir
  domisili        → key=domisili
  MBTI            → key=profil_mbti
  pola pikir      → key=pola_pikir_inti
  prinsip keputusan → key=prinsip_keputusan
  nilai hidup     → key=nilai_hidup

Jika user koreksi data identitas, gunakan key baku yang sama agar nilai lama ter-update otomatis.

MENGHAPUS MEMORI:
- Jika user meminta melupakan sesuatu, WAJIB jalankan: [MEMORY_FORGET:key=nama_memori]
- Hapus memori yang relevan, jangan yang lain.
- Tag [MEMORY:...] dan [MEMORY_FORGET:...] adalah instruksi sistem internal, JANGAN tampilkan ke user, letakkan di paling akhir respons.`
    };

    // Buat sesi baru jika belum ada
    let currentSessionId = session_id;
    if (!currentSessionId) {
      const quickTitle = userMessage.length > 25 ? userMessage.substring(0, 25) + "..." : userMessage;
      const { data: newSession } = await supabase
        .from('sessions').insert({ user_id: user.id, title: quickTitle }).select().single();
      currentSessionId = newSession.id;
      generateTitle(apiKey, userMessage, currentSessionId);
    }

    // Simpan pesan user (kecuali kalau edit)
    let finalUserMessageId = edit_message_id || user_message_id;
    if (!edit_message_id && !finalUserMessageId) {
      let effectiveParentId = parent_id;
      if (!effectiveParentId) {
        const { data: lastMsg } = await supabase.from('messages').select('id')
          .eq('session_id', currentSessionId).order('created_at', { ascending: false })
          .limit(1).maybeSingle();
        effectiveParentId = lastMsg?.id || null;
      }

      const { data: userMsgData } = await supabase.from('messages').insert({
        session_id: currentSessionId, role: 'user',
        content: userMessage, parent_id: effectiveParentId
      }).select().single();
      finalUserMessageId = userMsgData.id;
    }

    const ambiguityPayload = chatPreview.analyzeAmbiguityPreview(userMessage, person, allPersons || []);
    const emotionAnalysis = chatPreview.detectConversationEmotion(userMessage, recentHistory);
    const previewPayload = {
      preview_version: 2,
      title: chatPreview.REASONING_FINAL_TITLE,
      streaming_title: chatPreview.REASONING_STREAMING_TITLE,
      reasoning_steps: chatPreview.buildReasoningSteps({
        userMessage,
        currentPerson: person,
        allPersons: allPersons || [],
        recentHistory,
        targetPersona,
        ambiguityPayload,
        fileContext
      }),
      emotion: {
        primary: emotionAnalysis.primary_emotion,
        secondary: emotionAnalysis.secondary_emotions,
        confidence: emotionAnalysis.confidence,
        mixed: emotionAnalysis.mixed,
        contradiction: emotionAnalysis.contradiction,
        needs_caution: emotionAnalysis.needs_caution
      },
      ambiguity: ambiguityPayload
    };
    const clientPreviewPayload = chatPreview.buildClientPreviewPayload(previewPayload);
    const isAmbiguousPreview = !!ambiguityPayload.show_preview;
    let previewRecordId = null;

    try {
      const { data: previewInsert } = await supabase
        .from('message_previews')
        .insert({
          session_id: currentSessionId,
          user_message_id: finalUserMessageId,
          assistant_message_id: null,
          is_ambiguous: isAmbiguousPreview,
          confidence: ambiguityPayload.confidence,
          reason_codes: ambiguityPayload.reason_codes || [],
          preview_json: previewPayload
        })
        .select('id')
        .single();
      previewRecordId = previewInsert?.id || null;
    } catch (previewInsertErr) {
      console.error('[Preview] Gagal simpan preview audit:', previewInsertErr.message);
    }

    // ── STREAMING ──
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    // Send init event immediately so client always has session_id even if timeout
    res.write(`data: ${JSON.stringify({
      session_id: currentSessionId,
      user_message_id: finalUserMessageId,
      phase: 'init'
    })}

`);
    res.flush?.();

    if (clientPreviewPayload) {
      res.write(`data: ${JSON.stringify({
        preview: clientPreviewPayload,
        reasoning: clientPreviewPayload.reasoning_steps,
        preview_id: previewRecordId,
        session_id: currentSessionId,
        user_message_id: finalUserMessageId,
        phase: 'reasoning'
      })}\n\n`);
      res.flush?.();
    }

    const modelConfig = chatProvider.getModelConfig(personaList);
    const effectiveModelConfig = consistency_mode
      ? {
          ...modelConfig,
          temperature: Math.min(modelConfig.temperature, 0.2),
          top_p: Math.min(modelConfig.top_p, 0.85)
        }
      : modelConfig;
    const compactInstructionPrompt = isCompactCheckpointRequest
      ? {
          role: 'system',
          content: `MODE: COMPACT_CHECKPOINT
- Jawaban HARUS berbasis data yang sudah ada di riwayat chat/sesi ini.
- Jangan menambah fakta baru. Jika tidak ada data, tulis: "Belum ada data".
- Untuk setiap poin, bedakan jelas mana yang terverifikasi dan mana asumsi.
- Fokus untuk planning kerja/ngoding: detail, rapi, dan siap eksekusi.
- Jawaban ke user susun dengan bagian ini jika relevan:
  1. Ringkasan kondisi terkini
  2. Fakta atau keputusan yang sudah pasti
  3. Perubahan kode/file/artefak penting
  4. Risiko, kendala, atau asumsi aktif
  5. Next step paling masuk akal
- WAJIB sertakan blok ringkasan sesi final di AKHIR jawaban (tanpa markdown):
  [SESSION_CHECKPOINT]
  Tujuan utama:
  - ...
  Status terbaru:
  - ...
  Keputusan penting:
  - ...
  File/artefak penting:
  - ...
  Constraint/risiko:
  - ...
  Next step:
  - ...
  [/SESSION_CHECKPOINT]
- Ringkasan checkpoint harus berdiri sendiri, menyatukan konteks lama + konteks baru, maksimum 2200 karakter dan tetap padat.`
        }
      : null;

    // ── FRIEND MEMORY INJECTION ──
    let systemFriendContextPrompt = null;
    let knownFriendsData = []; // hoisted so post-processing guard can access it
    try {
      knownFriendsData = await chatContext.fetchFriendsWithMemories(supabase, person.id, 5) || [];
      // ALWAYS build friend context block (even if empty) so LLM knows what to reference
      const friendContextText = chatContext.buildFriendContextBlock(knownFriendsData);
      systemFriendContextPrompt = {
        role: 'system',
        content: friendContextText
      };
    } catch (friendErr) {
      console.error('[Friend Memory] Error fetching friend memories:', friendErr);
      // Fallback to empty friends context
      systemFriendContextPrompt = {
        role: 'system',
        content: chatContext.buildFriendContextBlock([])
      };
    }

    // ── DROPPED MEMORY BLOCK ──
    // Memori yang pernah diminta user untuk dilupakan, tapi jejak tetap tersedia
    let systemDroppedMemoryPrompt = null;
    if (droppedMemories.length > 0) {
      const droppedLines = droppedMemories
        .map(m => `- ${m.key}: ${m.value}`)
        .slice(0, 8);
      systemDroppedMemoryPrompt = {
        role: 'system',
        content: `[JEJAK MEMORI YANG PERNAH DILEPAS]\nMemori berikut pernah diminta dilupakan user. Jejak datanya masih tersimpan ringan.\nGunakan HANYA jika user tanya soal hal yang sudah dilupakan dengan sebutan seperti 'masih ingat soal X?', 'apa kau masih ingat', atau mempertanyakan hal lupa.\nSaat itu, sebutkan: "Aku masih ingat sedikit jejaknya — [data]." Jangan bawa sewaktu tidak ditanya.\n${droppedLines.join('\\n')}`
      };
    }

    // ── CHILD MEMORY BLOCK (untuk parents) ──
    // Data anak yang di-share antara kedua orang tua
    let systemChildMemoryPrompt = null;
    const userRole = person?.role || '';
    const isParent = userRole === 'ayah' || userRole === 'ibu';
    if (isParent && childMemoriesData.length > 0) {
      const childLines = childMemoriesData
        .flatMap(child => {
          const headerLine = `${child.name}:`;
          const memLines = (child.memories || [])
            .slice(0, 5)
            .map(m => `  - ${m.value || m.key}`);
          return [headerLine, ...memLines];
        })
        .slice(0, 25);
      systemChildMemoryPrompt = {
        role: 'system',
        content: `[DATA BERSAMA — CATATAN ANAK]\nData berikut dicatat salah satu orang tua dan berlaku untuk kedua orang tua. Jika ada info baru tentang anak, simpan dengan key baku.\n${childLines.join('\\n')}`
      };
    }

        // ── OPENROUTER CALL + RETRY/FALLBACK ──
    const openRouterPayload = {
      messages: [
        systemPrompt,
        systemIdentityPrompt,
        systemConsistencyPrompt,
        systemMemoryContextPrompt,
        ...(systemFriendContextPrompt ? [systemFriendContextPrompt] : []),
        systemEmotionGuidancePrompt,
        systemIntentSignalsPrompt,
        ...(systemCognitiveStylePrompt ? [systemCognitiveStylePrompt] : []),
        ...(systemDroppedMemoryPrompt ? [systemDroppedMemoryPrompt] : []),
        ...(systemChildMemoryPrompt ? [systemChildMemoryPrompt] : []),
        ...(systemSpeechStylePrompt ? [systemSpeechStylePrompt] : []),
        systemFinalInstructionPrompt,
        ...(compactInstructionPrompt ? [compactInstructionPrompt] : []),
        ...chatHistory,
        {
          role: 'user',
          content: userMessage
        }
      ],
      stream: true,
      temperature: effectiveModelConfig.temperature,
      max_tokens: effectiveModelConfig.max_tokens,
      top_p: effectiveModelConfig.top_p
    };

    const providerResult = await chatProvider.callOpenRouterWithRetry({ apiKey, payload: openRouterPayload });
    if (!providerResult.ok) {
      const errorDetail = providerResult.errorBody || 'Unknown error';
      console.error('[OpenRouter] ERROR DETAIL:', {
        status: providerResult.status,
        statusText: providerResult.statusText,
        model: providerResult.modelUsed,
        retries: providerResult.retryCount,
        fallback: providerResult.fallbackUsed,
        errorDetail
      });

      res.write(`data: ${JSON.stringify({
        error: `Provider returned error - ${providerResult.status} ${errorDetail}`,
        session_id: currentSessionId,
        user_message_id: finalUserMessageId
      })}\n\n`);
      res.end();
      return;
    }

    const aiResponse = providerResult.response;
    const modelUsed = providerResult.modelUsed;
    const retryCount = providerResult.retryCount;
    const fallbackUsed = providerResult.fallbackUsed;
    console.log(`[OpenRouter] Status response: ${aiResponse.status} ${aiResponse.statusText} | model=${modelUsed} | retries=${retryCount} | fallback=${fallbackUsed}`);

    const reader = aiResponse.body.getReader();
    const decoder = new TextDecoder();
    let fullReply = '';
    let buffer = '';
    const filterVisibleToken = createMemoryTagStreamFilter();
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {}
    }, 10000);

    function processSSEBuffer(buf) {
      const lines = buf.split('\n');
      const remainder = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (raw === '[DONE]') continue;
        try {
          const parsed = JSON.parse(raw);
          const token = parsed.choices?.[0]?.delta?.content || '';
          if (token) {
            fullReply += token;
            const visibleToken = filterVisibleToken(token, false);
            if (visibleToken) {
              res.write(`data: ${JSON.stringify({ token: visibleToken })}\n\n`);
              res.flush?.();
            }
          }
        } catch {}
      }
      return remainder;
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = processSSEBuffer(buffer);
      }
      // Flush decoder + sisa buffer
      buffer += decoder.decode();
      if (buffer.trim()) processSSEBuffer(buffer + '\n');
      const finalVisibleToken = filterVisibleToken('', true);
      if (finalVisibleToken) {
        res.write(`data: ${JSON.stringify({ token: finalVisibleToken })}\n\n`);
        res.flush?.();
      }
    } catch (streamErr) {
      console.error("Stream error:", streamErr.message);
    } finally {
      clearInterval(heartbeat);
    }

    // Simpan AI response ke DB — LANGSUNG setelah stream selesai, SEBELUM file processing
    if (true) {
      // ── PARSE & STRIP MEMORY CONTROL TAGS ──
      const memoryOps = chatMemory.parseMemoryInstructionTags(fullReply);
      const memoryQuality = chatMemory.filterMemoryUpserts(memoryOps.memoryUpserts, { maxItems: 3 });
      let detectedMemories = memoryQuality.accepted;
      const rejectedMemoryCandidates = memoryQuality.rejected;
      const detectedForgetKeys = memoryOps.forgetKeys;
      let cleanReply = memoryOps.cleanReply;
      const clarifyPolicy = chatContext.analyzeClarifyBehavior(fullReply, cleanReply, userMessage);

      if (!clarifyPolicy.allowMemoryWrite && detectedMemories.length > 0) {
        for (const mem of detectedMemories) {
          rejectedMemoryCandidates.push({
            key: chatMemory.normalizeMemoryKey(mem.key),
            reason: 'blocked_due_clarify'
          });
        }
        detectedMemories = [];
      }

      // ── PARSE & STRIP FRIEND SUGGESTION TAGS ──
      const friendOps = parseFriendSuggestionTags(cleanReply);
      let friendSuggestions = friendOps.friendSuggestions;
      cleanReply = friendOps.cleanReply;

      // ── SERVER-SIDE GUARD: suppress suggestions for already-known persons ──
      if (friendSuggestions.length > 0) {
        const knownNames = knownFriendsData.map(f => f.name);
        const filtered = [];
        for (const suggestion of friendSuggestions) {
          const sugName = suggestion.name;
          // Check against in-memory friend list with fuzzy matching
          const alreadyKnownFriend = knownNames.some(kn => isSimilarName(kn, sugName));
          if (alreadyKnownFriend) {
            console.log(`[Friend Guard] Suppressed duplicate suggestion for already-known: "${sugName}"`);
            continue;
          }
          // Also check persons table directly (catches edge cases where friendsData was empty)
          const { data: existingPersons } = await supabase
            .from('persons')
            .select('id, name')
            .ilike('name', sugName)
            .limit(1);
          if (existingPersons?.length > 0) {
            console.log(`[Friend Guard] Suppressed suggestion – "${sugName}" already in persons table`);
            continue;
          }
          filtered.push(suggestion);
        }
        friendSuggestions = filtered;
      }

      // If friend suggestions detected, send event to client
      if (friendSuggestions && friendSuggestions.length > 0) {
        for (const suggestion of friendSuggestions) {
          res.write(`data: ${JSON.stringify({
            type: 'friend-suggestion',
            friend_name: suggestion.name,
            intro_message: suggestion.intro_msg,
            phase: 'friend-detected'
          })}\n\n`);
        }
        res.flush?.();
      }

      const clarifyStripResult = chatContext.stripClarifyControlBlocks(cleanReply);
      cleanReply = clarifyStripResult.text.trimEnd();
      if (!cleanReply && clarifyStripResult.hadBlock) {
        cleanReply = clarifyPolicy.isEmotionalContext
          ? 'Aku dengerin kamu. Kita pelan-pelan dulu ya, aku bantu dari hal paling penting yang kamu rasakan sekarang, lalu kita lanjutkan langkah kecil yang paling aman.'
          : 'Aku butuh beberapa detail tambahan dulu. Pilih opsi di kotak yang muncul, atau isi lainnya.';
      }

      const checkpointSummaryToPersist = isCompactCheckpointRequest
        ? chatContext.extractCheckpointSummary(cleanReply)
        : '';

      if (isCompactCheckpointRequest) {
        const checkpointStripResult = chatContext.stripCheckpointControlBlocks(cleanReply);
        cleanReply = checkpointStripResult.text.trimEnd();
        if (!cleanReply && checkpointStripResult.hadBlock) {
          cleanReply = 'Checkpoint sesi berhasil diperbarui. Konteks lama sudah dipadatkan.';
        }
      }

      cleanReply = ensureVisibleAssistantReply(cleanReply, fullReply.trim() ? 'sanitized_empty' : 'provider_empty');
      const sourceReplyForFiles = cleanReply;

      // 1. Simpan dulu ke DB (clean reply tanpa memory tags)
      let aiMsgData;
      if (targetAssistantMessageId) {
        const { data: updatedAssistant, error: updateAssistantErr } = await supabase
          .from('messages')
          .update({
            content: cleanReply,
            parent_id: finalUserMessageId || edit_message_id
          })
          .eq('id', targetAssistantMessageId)
          .select()
          .single();

        if (updateAssistantErr) throw updateAssistantErr;
        aiMsgData = updatedAssistant;
      } else {
        const { data: insertedAssistant, error: insertAssistantErr } = await supabase
          .from('messages')
          .insert({
            session_id: currentSessionId,
            role: 'assistant',
            content: cleanReply,
            parent_id: finalUserMessageId || edit_message_id
          })
          .select()
          .single();

        if (insertAssistantErr) throw insertAssistantErr;
        aiMsgData = insertedAssistant;
      }

      await supabase.from('sessions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', currentSessionId);

      if (isCompactCheckpointRequest && currentSessionId && aiMsgData?.id) {
        try {
          await supabase
            .from('sessions')
            .update({
              compact_checkpoint_summary: checkpointSummaryToPersist || chatContext.compactHistoryMessage(cleanReply, 2600),
              compact_checkpoint_message_id: aiMsgData.id,
              compact_checkpoint_at: new Date().toISOString()
            })
            .eq('id', currentSessionId);
        } catch (checkpointErr) {
          console.error('[Checkpoint] Gagal simpan checkpoint sesi:', checkpointErr.message);
        }
      }

      const pendingFileState = chatFiles.buildPendingFileReply(sourceReplyForFiles);
      let finalReplyForClient = cleanReply;
      let fileJobMeta = null;
      let shouldUseInlineFileProcessing = false;

      if (pendingFileState.hasFiles && aiMsgData?.id) {
        finalReplyForClient = ensureVisibleAssistantReply(pendingFileState.pendingReply, 'file_pending');

        try {
          const queuedJob = await enqueueFileGenerationJob({
            sessionId: currentSessionId,
            userId: user.id,
            messageId: aiMsgData.id,
            sourceText: sourceReplyForFiles,
            pendingText: finalReplyForClient,
            fileCount: pendingFileState.files.length
          });

          await supabase
            .from('messages')
            .update({ content: finalReplyForClient })
            .eq('id', aiMsgData.id);

          aiMsgData = { ...aiMsgData, content: finalReplyForClient };
          fileJobMeta = {
            id: queuedJob.id,
            message_id: queuedJob.message_id,
            session_id: queuedJob.session_id,
            status: queuedJob.status,
            file_count: queuedJob.file_count,
            created_at: queuedJob.created_at
          };
        } catch (fileJobErr) {
          console.error('[FileJob] Gagal enqueue, fallback ke inline processing:', fileJobErr.message);
          shouldUseInlineFileProcessing = true;

          try {
            await supabase
              .from('messages')
              .update({ content: finalReplyForClient })
              .eq('id', aiMsgData.id);

            aiMsgData = { ...aiMsgData, content: finalReplyForClient };
          } catch (pendingUpdateErr) {
            console.error('[FileJob] Gagal update placeholder file:', pendingUpdateErr.message);
          }
        }
      }

      // 2. Kirim event `done` ke client SEGERA
      res.write(`data: ${JSON.stringify({
        done: true,
        session_id: currentSessionId,
        message_id: aiMsgData?.id,
        user_message_id: finalUserMessageId,
        final_text: finalReplyForClient,
        replace_stream_text: finalReplyForClient !== cleanReply,
        file_job: fileJobMeta,
        preview_id: previewRecordId,
        preview: clientPreviewPayload,
        persona_used: targetPersona,
        model_used: modelUsed,
        retry_count: retryCount,
        fallback_used: fallbackUsed,
        consistency_mode: !!consistency_mode
      })}\n\n`);
      res.flush?.();

      if (previewRecordId && aiMsgData?.id) {
        try {
          await supabase
            .from('message_previews')
            .update({ assistant_message_id: aiMsgData.id })
            .eq('id', previewRecordId);
        } catch (previewLinkErr) {
          console.error('[Preview] Gagal link preview -> assistant:', previewLinkErr.message);
        }
      }

      // ── UPSERT/ARCHIVE MEMORI AI SECARA BACKGROUND ──
      if ((detectedMemories.length > 0 || detectedForgetKeys.length > 0 || rejectedMemoryCandidates.length > 0) && user.person_id) {
        const memoryAuditEvents = [];
        const buildAuditEvent = (event = {}) => ({
          person_id: user.person_id,
          session_id: currentSessionId,
          source_message_id: event.source_message_id || aiMsgData?.id || null,
          ...event
        });
        const { data: existingMemories } = await supabase
          .from('person_memory')
          .select('id, key, value, memory_type, category, status, observation_count, confidence, memory_scope')
          .eq('person_id', user.person_id)
          .in('status', ['active', 'archived']);

        const memoryPool = Array.isArray(existingMemories) ? [...existingMemories] : [];

        if (rejectedMemoryCandidates.length > 0) {
          for (const rejected of rejectedMemoryCandidates) {
            memoryAuditEvents.push(buildAuditEvent({
              event_type: 'memory_rejected',
              reason_code: rejected.reason || 'unknown',
              payload: {
                key: rejected.key || null
              }
            }));
          }
        }

        for (const mem of detectedMemories) {
          try {
            const normalizedKey = chatMemory.normalizeMemoryKey(mem.key);
            const normalizedType = chatMemory.normalizeMemoryType(mem.memoryType);
            const normalizedValue = String(mem.value || '').trim();
            const normalizedCategory = String(mem.category || 'umum').trim().toLowerCase().slice(0, 60) || 'umum';
            const memoryInput = {
              key: normalizedKey,
              value: normalizedValue,
              memoryType: normalizedType,
              category: normalizedCategory
            };
            const memoryScope = chatMemory.resolveMemoryScope(memoryInput);
            const exact = memoryPool.find(item =>
              item.status === 'active' &&
              chatMemory.normalizeMemoryType(item.memory_type) === normalizedType &&
              chatMemory.normalizeMemoryKey(item.key) === normalizedKey
            );

            const sameValueMatch = exact || memoryPool.find(item => {
              if (item.status !== 'active') return false;
              if (chatMemory.normalizeMemoryType(item.memory_type) !== normalizedType) return false;
              return chatMemory.jaccardSimilarity(item.value, normalizedValue) >= 0.86;
            });

            const fuzzy = sameValueMatch || memoryPool.find(item => {
              if (item.status !== 'active') return false;
              if (chatMemory.normalizeMemoryType(item.memory_type) !== normalizedType) return false;
              return chatMemory.jaccardSimilarity(item.key, normalizedKey) >= 0.72;
            });

            const persistedKey = sameValueMatch?.id
              ? chatMemory.normalizeMemoryKey(sameValueMatch.key)
              : normalizedKey;
            const conflictDetected = fuzzy?.id ? isMeaningfulMemoryConflict(fuzzy.value, normalizedValue) : false;
            const evidenceAssessment = chatMemory.assessMemoryEvidence(memoryInput, emotionGuidance, speechProfile);
            const evidenceStatusOverride = conflictDetected && memoryScope === 'stable' ? 'conflict' : '';
            const evidencePayload = chatMemory.buildMemoryEvidenceRecord({
              personId: user.person_id,
              memoryId: fuzzy?.id || null,
              memory: memoryInput,
              sourceMessageId: aiMsgData?.id,
              sessionId: currentSessionId,
              userMessage,
              recentHistory,
              emotionGuidance,
              speechProfile,
              statusOverride: evidenceStatusOverride
            });
            const existingEvidence = await findMemoryEvidenceByContextHash(user.person_id, evidencePayload.unique_context_hash);

            if (existingEvidence?.id) {
              memoryAuditEvents.push(buildAuditEvent({
                event_type: 'memory_evidence_duplicate_context',
                memory_id: existingEvidence.memory_id || fuzzy?.id || null,
                evidence_id: existingEvidence.id,
                reason_code: 'duplicate_context_hash',
                payload: {
                  key: normalizedKey,
                  value: normalizedValue,
                  memory_type: normalizedType,
                  memory_scope: memoryScope
                }
              }));
              console.log(`[Memory][Evidence] Duplicate context skipped for "${normalizedKey}"`);
              continue;
            }

            if (conflictDetected && memoryScope === 'stable' && fuzzy?.id) {
              const { data: insertedConflictEvidence } = await insertMemoryEvidence({
                ...evidencePayload,
                memory_id: fuzzy.id,
                evidence_status: 'conflict'
              });

              memoryAuditEvents.push(buildAuditEvent({
                event_type: 'stable_memory_conflict_detected',
                memory_id: fuzzy.id,
                evidence_id: insertedConflictEvidence?.id || null,
                reason_code: 'stable_conflict_pending_review',
                payload: {
                  key: normalizedKey,
                  old_value: fuzzy.value,
                  new_value: normalizedValue,
                  memory_scope: memoryScope,
                  reliability_score: evidencePayload.reliability_score,
                  emotional_state: evidencePayload.emotional_state,
                  style_signals: evidencePayload.style_signals
                }
              }));
              console.log(`[Memory][Conflict] Stable memory conflict deferred for "${normalizedKey}"`);
              continue;
            }

            if (evidencePayload.evidence_status !== 'validated') {
              const { data: insertedProvisionalEvidence } = await insertMemoryEvidence({
                ...evidencePayload,
                memory_id: fuzzy?.id || null
              });

              memoryAuditEvents.push(buildAuditEvent({
                event_type: 'memory_evidence_deferred',
                memory_id: fuzzy?.id || null,
                evidence_id: insertedProvisionalEvidence?.id || null,
                reason_code: (evidenceAssessment.reasonCodes || []).join('|') || 'provisional_evidence',
                payload: {
                  key: normalizedKey,
                  value: normalizedValue,
                  memory_type: normalizedType,
                  memory_scope: memoryScope,
                  evidence_status: evidencePayload.evidence_status,
                  reliability_score: evidencePayload.reliability_score,
                  emotional_state: evidencePayload.emotional_state,
                  style_signals: evidencePayload.style_signals
                }
              }));
              console.log(`[Memory][Evidence] Deferred low-reliability memory "${normalizedKey}"`);
              continue;
            }

            if (fuzzy?.id && !conflictDetected) {
              const effectiveScope = fuzzy.memory_scope || memoryScope;
              const { data: insertedEvidence, duplicate } = await insertMemoryEvidence({
                ...evidencePayload,
                memory_id: fuzzy.id,
                memory_key: persistedKey,
                memory_scope: effectiveScope
              });

              if (duplicate) {
                memoryAuditEvents.push(buildAuditEvent({
                  event_type: 'memory_evidence_duplicate_context',
                  memory_id: fuzzy.id,
                  reason_code: 'duplicate_context_hash_race',
                  payload: {
                    key: persistedKey,
                    value: normalizedValue,
                    memory_type: normalizedType,
                    memory_scope: effectiveScope
                  }
                }));
                continue;
              }

              const validatedEvidenceCount = await countValidatedMemoryEvidence(fuzzy.id);
              const aggregateMetrics = chatMemory.computeEvidenceBackedMetrics({
                validatedEvidenceCount,
                memoryScope: effectiveScope
              });

              await supabase.from('person_memory')
                .update({
                  key: persistedKey,
                  value: normalizedValue,
                  memory_type: normalizedType,
                  category: normalizedCategory,
                  status: 'active',
                  memory_scope: effectiveScope,
                  observation_count: aggregateMetrics.observationCount,
                  confidence: aggregateMetrics.confidence,
                  priority_score: aggregateMetrics.priorityScore,
                  source_message_id: aiMsgData?.id,
                  deleted_at: null,
                  deleted_by: null,
                  deletion_reason: null
                })
                .eq('id', fuzzy.id);

              const poolIdx = memoryPool.findIndex(item => item.id === fuzzy.id);
              if (poolIdx >= 0) {
                memoryPool[poolIdx] = {
                  ...memoryPool[poolIdx],
                  key: persistedKey,
                  value: normalizedValue,
                  memory_type: normalizedType,
                  category: normalizedCategory,
                  status: 'active',
                  memory_scope: effectiveScope,
                  observation_count: aggregateMetrics.observationCount,
                  confidence: aggregateMetrics.confidence
                };
              }

              memoryAuditEvents.push(buildAuditEvent({
                event_type: 'memory_updated',
                memory_id: fuzzy.id,
                evidence_id: insertedEvidence?.id || null,
                reason_code: 'validated_evidence',
                payload: {
                  key: persistedKey,
                  memory_scope: effectiveScope,
                  observation_count: aggregateMetrics.observationCount,
                  confidence: aggregateMetrics.confidence,
                  reliability_score: evidencePayload.reliability_score
                }
              }));
              console.log(`[Memory] Update "${persistedKey}" for person ${user.person_id}`);
              continue;
            }

            const variantKey = conflictDetected ? buildConflictVariantKey(normalizedKey, memoryPool) : normalizedKey;
            const insertMetrics = chatMemory.computeEvidenceBackedMetrics({
              validatedEvidenceCount: 1,
              memoryScope
            });
            const insertPayload = {
              person_id: user.person_id,
              key: variantKey,
              value: normalizedValue,
              memory_type: normalizedType,
              category: conflictDetected ? 'konflik' : normalizedCategory,
              status: 'active',
              memory_scope: memoryScope,
              confidence: insertMetrics.confidence,
              observation_count: insertMetrics.observationCount,
              priority_score: insertMetrics.priorityScore,
              source_message_id: aiMsgData?.id
            };

            const { data: insertedMemory } = await supabase
              .from('person_memory')
              .insert(insertPayload)
              .select('id, key, value, memory_type, category, status, observation_count, confidence, memory_scope')
              .single();

            if (insertedMemory) memoryPool.push(insertedMemory);

            const { data: insertedEvidence, duplicate } = await insertMemoryEvidence({
              ...evidencePayload,
              memory_id: insertedMemory?.id || null,
              memory_key: insertedMemory?.key || variantKey,
              category: insertedMemory?.category || insertPayload.category,
              memory_scope: insertedMemory?.memory_scope || memoryScope
            });

            if (duplicate) {
              memoryAuditEvents.push(buildAuditEvent({
                event_type: 'memory_evidence_duplicate_context',
                memory_id: insertedMemory?.id || null,
                reason_code: 'duplicate_context_after_insert',
                payload: {
                  key: insertedMemory?.key || variantKey,
                  value: normalizedValue,
                  memory_type: normalizedType,
                  memory_scope: memoryScope
                }
              }));
            }

            memoryAuditEvents.push(buildAuditEvent({
              event_type: conflictDetected ? 'memory_conflict_variant_created' : 'memory_inserted',
              memory_id: insertedMemory?.id || null,
              evidence_id: insertedEvidence?.id || null,
              reason_code: conflictDetected ? 'validated_conflict_variant' : 'validated_evidence',
              payload: conflictDetected
                ? {
                    base_key: normalizedKey,
                    variant_key: insertedMemory?.key || variantKey,
                    old_value: fuzzy?.value || null,
                    new_value: normalizedValue,
                    memory_scope: memoryScope
                  }
                : {
                    key: insertedMemory?.key || variantKey,
                    memory_scope: memoryScope,
                    confidence: insertMetrics.confidence
                  }
            }));
            console.log(`[Memory] Insert "${insertedMemory?.key || variantKey}" for person ${user.person_id}`);
          } catch (memErr) {
            console.error(`[Memory] Gagal upsert "${mem.key}":`, memErr.message);
            memoryAuditEvents.push(buildAuditEvent({
              event_type: 'memory_processing_failed',
              reason_code: 'upsert_failed',
              payload: {
                key: chatMemory.normalizeMemoryKey(mem?.key || ''),
                message: memErr.message
              }
            }));
          }
        }

        if (detectedForgetKeys.length > 0) {
          for (const rawKey of detectedForgetKeys) {
            try {
              const normalizedForgetKey = chatMemory.normalizeMemoryKey(rawKey);
              const candidate = memoryPool.find(item => {
                if (item.status !== 'active') return false;
                const keySimilarity = chatMemory.jaccardSimilarity(item.key, normalizedForgetKey);
                const valueSimilarity = chatMemory.jaccardSimilarity(item.value, normalizedForgetKey);
                return chatMemory.normalizeMemoryKey(item.key) === normalizedForgetKey || keySimilarity >= 0.72 || valueSimilarity >= 0.78;
              });

              if (!candidate?.id) continue;

              await supabase
                .from('person_memory')
                .update({
                  status: 'dropped',
                  priority_score: 0.02,
                  deletion_reason: 'user_forget_command',
                  deleted_by: user.id,
                  source_message_id: aiMsgData?.id
                })
                .eq('id', candidate.id)
                .eq('status', 'active');

              const poolIdx = memoryPool.findIndex(item => item.id === candidate.id);
              if (poolIdx >= 0) memoryPool[poolIdx].status = 'dropped';
              memoryAuditEvents.push(buildAuditEvent({
                event_type: 'memory_dropped',
                memory_id: candidate.id,
                reason_code: 'user_forget_command',
                payload: {
                  key: candidate.key
                }
              }));
              console.log(`[Memory] Drop "${candidate.key}" for person ${user.person_id}`);
            } catch (forgetErr) {
              console.error(`[Memory] Gagal archive "${rawKey}":`, forgetErr.message);
            }
          }
        }

        if (memoryAuditEvents.length > 0) {
          await writeLegacyAuditEntries(memoryAuditEvents);
          console.log('[Memory][Audit]', JSON.stringify({
            person_id: user.person_id,
            session_id: currentSessionId,
            assistant_message_id: aiMsgData?.id || null,
            event_count: memoryAuditEvents.length,
            events: memoryAuditEvents
          }));
        }
      }

      // 3. File processing fallback (hanya jika queue/job belum siap)
      if (shouldUseInlineFileProcessing) {
        try {
          const fallbackResult = await chatFiles.processGeneratedFiles({
            supabase,
            sourceText: sourceReplyForFiles
          });

          if (fallbackResult.hasFiles && aiMsgData?.id) {
            await supabase.from('messages')
              .update({ content: fallbackResult.processedReply })
              .eq('id', aiMsgData.id);
          }
        } catch (fileErr) {
          console.error('File processing fallback error:', fileErr.message);

          if (aiMsgData?.id) {
            const failedReply = chatFiles.buildFailedFileReply(finalReplyForClient, fileErr.message);
            await supabase.from('messages')
              .update({ content: failedReply })
              .eq('id', aiMsgData.id)
              .catch(() => {});
          }
        }
      }
    }

    res.end();

  } catch (error) {
    console.error("=== ERROR ===", error.message);
    if (!res.headersSent) {
      return res.status(500).json({ error: error.message });
    }
    res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    res.end();
  }
}

async function generateTitle(apiKey, userMessage, sessionId) {
  try {
    const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        model: chatProvider.MAIN_MODEL,
        messages: [{ role: "user", content: `Buatkan judul obrolan yang sangat singkat (1-3 kata saja) untuk pesan ini: "${userMessage}". Balas HANYA dengan judul, tanpa tanda kutip, tanpa titik, tanpa basa-basi.` }],
        temperature: 0.3, max_tokens: 20
      })
    });
    if (!r.ok) {
      throw new Error(`Title API ${r.status} ${r.statusText}`);
    }
    const d = await r.json();
    const title = d.choices?.[0]?.message?.content?.replace(/["'.]/g, '').trim();
    if (title) {
      await supabase.from('sessions').update({ title }).eq('id', sessionId);
    }
  } catch (err) {
    console.error('[Title] Gagal generate judul sesi:', {
      sessionId,
      message: err?.message || String(err)
    });
  }
}