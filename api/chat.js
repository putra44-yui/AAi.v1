export const maxDuration = 300;
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { createClient } from '@supabase/supabase-js';

let Document, Packer, Paragraph, TextRun;
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

function buildMemoryContext(memories = []) {
  if (!Array.isArray(memories) || memories.length === 0) return 'Tidak ada memori.';

  const labelByType = {
    pattern: 'Pattern',
    kebiasaan: 'Kebiasaan',
    cara_berpikir: 'Cara Berpikir',
    preferensi: 'Preferensi',
    emosi: 'Emosi',
    fakta: 'Fakta'
  };

  const grouped = new Map();
  for (const memory of memories) {
    const type = normalizeMemoryType(memory.memory_type || 'fakta');
    if (!grouped.has(type)) grouped.set(type, []);

    const confidence = Number(memory.confidence || 0.7);
    const confidenceLabel = confidence >= 0.85 ? 'tinggi' : confidence >= 0.65 ? 'sedang' : 'rendah';
    grouped.get(type).push(`- [${confidenceLabel}] ${memory.key}: ${memory.value}`);
  }

  const orderedTypes = ['pattern', 'kebiasaan', 'cara_berpikir', 'preferensi', 'emosi', 'fakta'];
  const blocks = [];
  for (const type of orderedTypes) {
    const rows = grouped.get(type);
    if (!rows?.length) continue;
    blocks.push(`${labelByType[type]}:\n${rows.join('\n')}`);
  }

  return blocks.join('\n\n') || 'Tidak ada memori.';
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

  return function filterChunk(chunk = '', flush = false) {
    if (chunk) buffer += chunk;

    let visible = '';

    while (buffer.length > 0) {
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

      const prefixCandidates = [MEMORY_TAG_PREFIX, MEMORY_FORGET_TAG_PREFIX]
        .map(prefix => ({ prefix, index: buffer.indexOf(prefix) }))
        .filter(item => item.index !== -1)
        .sort((a, b) => a.index - b.index);

      if (prefixCandidates.length > 0) {
        const selected = prefixCandidates[0];
        visible += buffer.slice(0, selected.index);
        buffer = buffer.slice(selected.index + selected.prefix.length);
        suppressingMemoryTag = true;
        continue;
      }

      if (flush) {
        visible += buffer;
        buffer = '';
        break;
      }

      const maxPrefixLength = Math.max(MEMORY_TAG_PREFIX.length, MEMORY_FORGET_TAG_PREFIX.length);
      const safeLength = Math.max(0, buffer.length - (maxPrefixLength - 1));
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

  if (hasQuestion) usedContext.push('Tujuan umum pesan terdeteksi sebagai pertanyaan/permintaan.');
  if (currentPerson?.name) usedContext.push(`Pengirim pesan teridentifikasi: ${currentPerson.name}.`);
  if (hasNamedPerson) usedContext.push('Ada penyebutan nama yang membantu memperjelas target.');

  if (text.length < 18) {
    potentials.push('Pesan sangat singkat sehingga maksud detail belum cukup jelas.');
    missingContext.push('Tambahkan tujuan akhir yang diinginkan (contoh output atau hasil).');
  }

  if (!hasQuestion) {
    potentials.push('Belum ada kata tanya/aksi yang jelas, sehingga AI bisa menebak tujuan.');
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

  assumptions.push('AI akan memprioritaskan konteks terbaru di sesi ini bila tidak ada penjelasan tambahan.');
  if (!hasNamedPerson && personNames.length > 0) {
    assumptions.push('Jika ada rujukan orang tanpa nama, AI bisa salah memilih individu yang dimaksud.');
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
    ? 'Saya menangkap bahwa kamu sedang meminta bantuan sesuai pesan di atas, namun beberapa detail bisa ditafsirkan lebih dari satu cara.'
    : 'Saya menangkap ini sebagai pernyataan/permintaan umum, sehingga tujuan akhir bisa berbeda tergantung maksud yang kamu inginkan.';

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
    'Rosalia':         { temperature: 0.95, max_tokens: 1000, top_p: 0.95 }, 
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

// ✅ HELPER: Upload Base64 ke Supabase Storage
async function uploadFileToStorage(base64String, fileName, mimeType) {
  const base64 = base64String.split(',')[1];
  const buffer = Buffer.from(base64, 'base64');
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = `uploads/${Date.now()}-${safeName}`;
  
  const { error } = await supabase.storage
    .from('aai-files')
    .upload(filePath, buffer, { contentType: mimeType, upsert: false });
  if (error) throw new Error(`Gagal upload: ${error.message}`);
  
  const { data: { publicUrl } } = supabase.storage.from('aai-files').getPublicUrl(filePath);
  return publicUrl;
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
        .eq('is_ambiguous', true)
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
          preview: linked.preview_json,
          preview_id: linked.id,
          preview_confidence: linked.confidence,
          preview_reason_codes: linked.reason_codes || []
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
          const url = await uploadFileToStorage(f.base64, f.name, f.type);
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
            const pdfText = await extractPdfText(buffer);
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
    const memoryWeights = resolveMemoryScoreWeights();
    const minPreferredRelevance = parseFloatEnv('AAI_MEMORY_MIN_RELEVANCE_PREFERRED', 0.18, 0, 1);
    const minOtherRelevance = parseFloatEnv('AAI_MEMORY_MIN_RELEVANCE_OTHER', 0.28, 0, 1);
    const experimentProfile = resolveMemoryExperimentProfile(memory_experiment_mode, {
      weights: memoryWeights,
      minPreferredRelevance,
      minOtherRelevance,
      relevantMemoryLimit
    });

    // 2. Family context (sama seperti sebelumnya)
    const { data: allPersons } = await supabase.from('persons').select('name, date_of_birth, role');
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

    const { data: memories } = await supabase
      .from('person_memory')
      .select('id, key, value, confidence, observation_count, updated_at, priority_score, memory_type, category, status')
      .eq('person_id', user.person_id)
      .eq('status', 'active')
      .order('priority_score', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(injectedMemoryLimit);
    const relevantSelection = selectRelevantMemories(memories || [], userMessage, {
      limit: experimentProfile.relevantMemoryLimit,
      weights: experimentProfile.weights,
      minPreferredRelevance: experimentProfile.minPreferredRelevance,
      minOtherRelevance: experimentProfile.minOtherRelevance
    });
    const relevantMemories = relevantSelection.items;
    const memoryText = buildMemoryContext(relevantMemories);

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
      ? buildOlderHistorySummary(checkpointScopedHistory.slice(0, -effectiveMaxHistory))
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

    const contextualPriorityBlock = [
      '[USER MESSAGE]',
      userMessage || '-',
      '',
      '[RELEVANT MEMORY]',
      `Intent terdeteksi: ${relevantSelection.intent || 'general'}`,
      `Tipe prioritas: ${(relevantSelection.preferredTypes || []).join(', ') || '-'}`,
      `Experiment mode: ${experimentProfile.mode}`,
      memoryText || 'Tidak ada memori.',
      '',
      '[LAST CHAT]',
      buildLastChatContext(recentHistory)
    ].join('\n');

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

    const { data: personasData } = await supabase
      .from('ai_personas').select('name, system_prompt').in('name', personaList);
    const combinedSystem = personasData?.map(p => `=== GAYA: ${p.name} ===\n${p.system_prompt}`).join('\n\n') || '';

    // 5. System prompt 
    const systemPrompt = {
      role: "system",
      content: `Kamu adalah AAi, AI keluarga yang cerdas dan ramah.

Current speaker: ${person?.name} (${person?.role}, ${currentAge} tahun)

Keluarga:\n${familyContext}

Relasi:\n${relationContext}

Konteks prioritas (WAJIB jadi rujukan awal):\n${contextualPriorityBlock}

${fileContext}

Persona aktif: ${personaList.join(' + ')}
${combinedSystem}

ATURAN PENTING:
- Gunakan bahasa Indonesia sehari-hari + emoji, respons panjang dan detail.
- Bantu pekerjaan konsep sulit, excel, coding, dll.
- untuk user bernama teguh ketika meminta perbaiki bug, membuat fitur atau coding selain ia bukan bertanya apa penyebabnya atau bukan mode diskusi :
      1.utamakan memberikan coding, dibanding penjelasan panjang untuk hemat token jika user = teguh. 
      2.teguh sedang merancang sistem ai dan ux sebagai pemula, berikan coding terbaik untuk jangka panjang, bukan solusi cepat yang mungkin bikin masalah di kemudian hari.
      3. planingnya memanfaatkan ai yang ada dalam membangun sistem ai, ketika ia sudah punya modal, ia akan mengganti otak nya menjadi versi server lokal.
      4. jika teguh meminta sesuatu fitur atau suatu hal yang tidak begitu penting, berikan penjelasan atau opsi alternatif lebih baik yang berguna untuk masa depan.
- untuk user rosalia :
      1. utamakan bahasa yang lembut, penuh kasih sayang, dan dukungan emosional serta dengan candaan.
      2. bantu dia belajar dunia teknologi dan pemrograman dengan cara yang menyenangkan, tanpa membuatnya merasa kewalahan.
- Jangan gunakan panggilan gw, lu, gue, lo. Utamakan nama, "kamu" atau sayang.
- Jawab langsung dan lengkap. DILARANG memotong jawaban di tengah.
- Jika ada URL gambar/file di atas, sebutkan bahwa file berhasil diterima dan berikan link jika relevan.
- Jika user melampirkan file/teks, WAJIB konfirmasi dulu: "File [nama] berhasil dibaca. Berikut ringkasannya:" sebelum menjawab pertanyaan utama.
- Jika user melampirkan file .js/.mjs/.cjs, baca sebagai kode JavaScript dan gunakan isinya sebagai konteks utama.
- Lampiran gambar/file hanya konteks. Jangan otomatis menganggap user ingin generate file; nilai dulu tujuan dari isi percakapannya.
- Jika user minta buat file, WAJIB gunakan format: [FILE_START:nama_file.ext] (isi konten) [FILE_END]. Gunakan .txt untuk teks, .xlsb untuk tabel (pisahkan kolom dengan tanda #, BUKAN koma), .docx untuk dokumen.
- Untuk file .xlsb, gunakan format tabel rapi dengan header di baris pertama. Jika ada 2 dataset/sheet, gunakan format ini agar backend bisa auto-sanding:
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
  1) JSON wajib valid, tanpa trailing comma, tanpa komentar, tanpa markdown.
  2) Isi 1-4 pertanyaan, tiap pertanyaan 2-4 opsi singkat.
  3) key wajib huruf kecil + underscore.
  4) Gunakan mekanisme ini untuk file, kode, gambar, atau percakapan umum jika konteks masih kurang.
  5) Jika memakai blok ini, JANGAN beri hasil final dulu. Tunggu jawaban user berikutnya.
  6) Jika memakai blok ini, JANGAN tambahkan tag [MEMORY:...] di respons itu.
- Setelah generate, AI tidak perlu menjelaskan proses teknis. Langsung berikan link download.
- Jangan abaikan konten lampiran. Gunakan sebagai konteks utama jika relevan.
- Jika user minta macro/VBA, WAJIB buat 2 file terpisah:
  1. [FILE_START:data_nama.xlsb] (data tabel, pisah kolom dengan #) [FILE_END]
  2. [FILE_START:macro_nama.bas] (kode VBA lengkap, tanpa markdown) [FILE_END]
- Setelah generate, AI tidak perlu menjelaskan proses teknis. Langsung berikan link download + instruksi singkat: "Alt+F11 → File → Import Module → pilih .bas → Run".

ATURAN MEMORI (SANGAT PENTING – SELALU IKUTI):
- Kamu sedang mengenal ${person?.name} dari awal. Setiap percakapan adalah kesempatan untuk belajar tentangnya.
- Jika kamu mendeteksi memori baru tentang ${person?.name} (pattern, kebiasaan, cara berpikir, preferensi, emosi, fakta), sisipkan tag memori terstruktur di AKHIR responmu:
  [MEMORY:type=pattern;category=komunikasi;key=gaya_jawab;value=suka langsung ke inti]
- memory type wajib salah satu: pattern, kebiasaan, cara_berpikir, preferensi, emosi, fakta.
- Maksimal 3 tag [MEMORY:...] per respons.
- Jika isi memori mirip dengan memori lama, tetap gunakan key yang paling relevan agar sistem melakukan update, bukan menambah duplikat.
- Jika user meminta melupakan sesuatu, gunakan tag:
  [MEMORY_FORGET:key=nama_memori]
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

    const previewPayload = analyzeAmbiguityPreview(userMessage, person, allPersons || []);
    const shouldShowPreview = !!previewPayload.show_preview;
    let previewRecordId = null;

    if (shouldShowPreview) {
      try {
        const { data: previewInsert } = await supabase
          .from('message_previews')
          .insert({
            session_id: currentSessionId,
            user_message_id: finalUserMessageId,
            assistant_message_id: null,
            is_ambiguous: true,
            confidence: previewPayload.confidence,
            reason_codes: previewPayload.reason_codes || [],
            preview_json: previewPayload
          })
          .select('id')
          .single();
        previewRecordId = previewInsert?.id || null;
      } catch (previewInsertErr) {
        console.error('[Preview] Gagal simpan preview audit:', previewInsertErr.message);
      }
    }

    // ── STREAMING ──
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    if (shouldShowPreview) {
      res.write(`data: ${JSON.stringify({
        preview: previewPayload,
        preview_id: previewRecordId,
        phase: 'preview'
      })}\n\n`);
      res.flush?.();
    }

    const modelConfig = getModelConfig(personaList);
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

        // ── OPENROUTER CALL + RETRY/FALLBACK ──
    const openRouterPayload = {
      messages: [
        systemPrompt,
        ...(compactInstructionPrompt ? [compactInstructionPrompt] : []),
        ...chatHistory,
        {
          role: 'user',
          content: `${userMessage}${fileContext ? `\n\n📎 LAMPIRAN FILE:\n${fileContext}` : ''}`
        }
      ],
      stream: true,
      temperature: effectiveModelConfig.temperature,
      max_tokens: effectiveModelConfig.max_tokens,
      top_p: effectiveModelConfig.top_p
    };

    const providerResult = await callOpenRouterWithRetry({ apiKey, payload: openRouterPayload });
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

      res.write(`data: ${JSON.stringify({ error: `Provider returned error - ${providerResult.status} ${errorDetail}` })}\n\n`);
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
    if (fullReply.trim()) {
      // ── PARSE & STRIP MEMORY CONTROL TAGS ──
      const memoryOps = parseMemoryInstructionTags(fullReply);
      const detectedMemories = memoryOps.memoryUpserts;
      const detectedForgetKeys = memoryOps.forgetKeys;
      let cleanReply = memoryOps.cleanReply;

      const clarifyStripResult = stripClarifyControlBlocks(cleanReply);
      cleanReply = clarifyStripResult.text.trimEnd();
      if (!cleanReply && clarifyStripResult.hadBlock) {
        cleanReply = 'Aku butuh beberapa detail tambahan dulu. Pilih opsi di kotak yang muncul, atau isi lainnya.';
      }

      const checkpointSummaryToPersist = isCompactCheckpointRequest
        ? extractCheckpointSummary(cleanReply)
        : '';

      if (isCompactCheckpointRequest) {
        const checkpointStripResult = stripCheckpointControlBlocks(cleanReply);
        cleanReply = checkpointStripResult.text.trimEnd();
        if (!cleanReply && checkpointStripResult.hadBlock) {
          cleanReply = 'Checkpoint sesi berhasil diperbarui. Konteks lama sudah dipadatkan.';
        }
      }

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
              compact_checkpoint_summary: checkpointSummaryToPersist || compactHistoryMessage(cleanReply, 2600),
              compact_checkpoint_message_id: aiMsgData.id,
              compact_checkpoint_at: new Date().toISOString()
            })
            .eq('id', currentSessionId);
        } catch (checkpointErr) {
          console.error('[Checkpoint] Gagal simpan checkpoint sesi:', checkpointErr.message);
        }
      }

      // 2. Kirim event `done` ke client SEGERA
      res.write(`data: ${JSON.stringify({
        done: true,
        session_id: currentSessionId,
        message_id: aiMsgData?.id,
        user_message_id: finalUserMessageId,
        preview_id: previewRecordId,
        preview: shouldShowPreview ? previewPayload : null,
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
      if ((detectedMemories.length > 0 || detectedForgetKeys.length > 0) && user.person_id) {
        const { data: existingMemories } = await supabase
          .from('person_memory')
          .select('id, key, value, memory_type, category, status, observation_count')
          .eq('person_id', user.person_id)
          .in('status', ['active', 'archived']);

        const memoryPool = Array.isArray(existingMemories) ? [...existingMemories] : [];

        for (const mem of detectedMemories) {
          try {
            const normalizedKey = normalizeMemoryKey(mem.key);
            const normalizedType = normalizeMemoryType(mem.memoryType);
            const exact = memoryPool.find(item =>
              item.status === 'active' &&
              normalizeMemoryType(item.memory_type) === normalizedType &&
              normalizeMemoryKey(item.key) === normalizedKey
            );

            const fuzzy = exact || memoryPool.find(item => {
              if (item.status !== 'active') return false;
              if (normalizeMemoryType(item.memory_type) !== normalizedType) return false;
              return jaccardSimilarity(item.key, normalizedKey) >= 0.72;
            });

            if (fuzzy?.id) {
              await supabase.from('person_memory')
                .update({
                  key: normalizedKey,
                  value: mem.value,
                  memory_type: normalizedType,
                  category: mem.category || 'umum',
                  status: 'active',
                  source_message_id: aiMsgData?.id,
                  deleted_at: null,
                  deleted_by: null,
                  deletion_reason: null
                })
                .eq('id', fuzzy.id);
              console.log(`[Memory] Update "${normalizedKey}" for person ${user.person_id}`);
              continue;
            }

            const insertPayload = {
              person_id: user.person_id,
              key: normalizedKey,
              value: mem.value,
              memory_type: normalizedType,
              category: mem.category || 'umum',
              status: 'active',
              confidence: 0.7,
              observation_count: 1,
              priority_score: computePriorityScore(0.7, 1),
              source_message_id: aiMsgData?.id
            };

            const { data: insertedMemory } = await supabase
              .from('person_memory')
              .insert(insertPayload)
              .select('id, key, value, memory_type, category, status, observation_count')
              .single();

            if (insertedMemory) memoryPool.push(insertedMemory);
            console.log(`[Memory] Insert "${normalizedKey}" for person ${user.person_id}`);
          } catch (memErr) {
            console.error(`[Memory] Gagal upsert "${mem.key}":`, memErr.message);
          }
        }

        if (forgetIntentRequested && detectedForgetKeys.length > 0) {
          for (const rawKey of detectedForgetKeys) {
            try {
              const normalizedForgetKey = normalizeMemoryKey(rawKey);
              const candidate = memoryPool.find(item => {
                if (item.status !== 'active') return false;
                const keySimilarity = jaccardSimilarity(item.key, normalizedForgetKey);
                const valueSimilarity = jaccardSimilarity(item.value, normalizedForgetKey);
                return normalizeMemoryKey(item.key) === normalizedForgetKey || keySimilarity >= 0.72 || valueSimilarity >= 0.78;
              });

              if (!candidate?.id) continue;

              await supabase
                .from('person_memory')
                .update({
                  status: 'archived',
                  deletion_reason: 'user_forget_command',
                  deleted_by: user.id,
                  source_message_id: aiMsgData?.id
                })
                .eq('id', candidate.id)
                .eq('status', 'active');

              const poolIdx = memoryPool.findIndex(item => item.id === candidate.id);
              if (poolIdx >= 0) memoryPool[poolIdx].status = 'archived';
              console.log(`[Memory] Archive "${candidate.key}" for person ${user.person_id}`);
            } catch (forgetErr) {
              console.error(`[Memory] Gagal archive "${rawKey}":`, forgetErr.message);
            }
          }
        }
      }

      // 3. File processing di background (setelah client sudah dapat `done`)
      try {
        const fileRegex = /\[FILE_START:(.+?)\]([\s\S]*?)\[FILE_END\]/g;
        let match;
        let processedReply = cleanReply;
        let hasFiles = false;
        const fileSourceText = cleanReply;

        while ((match = fileRegex.exec(fileSourceText)) !== null) {
          hasFiles = true;
          const filename = match[1].trim();
          const content = sanitizeGeneratedFileBlock(match[2]);
          const ext = filename.split('.').pop().toLowerCase();

          let buffer;
          try {
            if (ext === 'txt') {
              buffer = Buffer.from(content, 'utf-8');
            } 
            else if (ext === 'bas' || ext === 'vba') {
              const normalizedVba = content.replace(/\n/g, '\r\n');
              buffer = Buffer.from(normalizedVba, 'utf-8');
            } 
            else if (ext === 'xlsb' || ext === 'xlsx' || ext === 'xls') {
              const parsedSheets = parseSheetBlocks(content);
              if (!parsedSheets.length) {
                throw new Error('Konten tabel kosong. Gunakan format kolom dengan pemisah # di setiap baris.');
              }

              const sheetsToBuild = buildSandingWorkbookSheets(parsedSheets);
              const wb = XLSX.utils.book_new();

              for (const sheet of sheetsToBuild) {
                const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
                applyWorksheetColumnWidths(ws, sheet.rows);
                XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
              }

              buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsb' });
            } 
            else if (ext === 'docx') {
              const docx = await import('docx');
              Document = docx.Document;
              Packer = docx.Packer;
              Paragraph = docx.Paragraph;
              TextRun = docx.TextRun;
              const paragraphs = content.split('\n').map(line =>
                new Paragraph({ children: [new TextRun({ text: line, font: 'Arial', size: 24 })] })
              );
              const doc = new Document({ sections: [{ children: paragraphs }] });
              buffer = await Packer.toBuffer(doc);
            } else {
              buffer = Buffer.from(content, 'utf-8');
            }

            const filePath = `generations/${Date.now()}-${filename}`;
            const mimeMap = {
              'xlsb': 'application/vnd.ms-excel.sheet.binary.macroEnabled.12',
              'bas': 'text/plain',
              'vba': 'text/plain',
              'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            };

            const { error } = await supabase.storage.from('aai-files').upload(filePath, buffer, {
              contentType: mimeMap[ext] || 'text/plain',
              upsert: false
            });

            if (!error) {
              const { data: { publicUrl } } = supabase.storage.from('aai-files').getPublicUrl(filePath);
              processedReply = processedReply.replace(match[0], `📥 **[Download ${filename}](${publicUrl})**`);
            } else {
              processedReply = processedReply.replace(match[0], `⚠️ Gagal upload: ${error.message}`);
            }
          } catch (e) {
            console.error(`⚠️ Gagal generate ${filename}:`, e.message);
            processedReply = processedReply.replace(match[0], `⚠️ Error: ${e.message}`);
          }
        }

        // Update DB dengan versi yang sudah diproses (file links)
        if (hasFiles && aiMsgData?.id) {
          await supabase.from('messages')
            .update({ content: processedReply })
            .eq('id', aiMsgData.id);
        }
      } catch (fileErr) {
        console.error("File processing error:", fileErr.message);
      }
    } else {
      res.write(`data: ${JSON.stringify({ error: 'Respons kosong dari model.' })}\n\n`);
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
      body: JSON.stringify({
        model: MAIN_MODEL,
        messages: [{ role: "user", content: `Buatkan judul obrolan yang sangat singkat (1-3 kata saja) untuk pesan ini: "${userMessage}". Balas HANYA dengan judul, tanpa tanda kutip, tanpa titik, tanpa basa-basi.` }],
        temperature: 0.3, max_tokens: 20
      })
    });
    const d = await r.json();
    const title = d.choices?.[0]?.message?.content?.replace(/["'.]/g, '').trim();
    if (title) {
      await supabase.from('sessions').update({ title }).eq('id', sessionId);
    }
  } catch {}
}