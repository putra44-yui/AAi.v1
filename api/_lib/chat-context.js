import { buildMemoryContext, normalizeMemoryType } from './chat-memory.js';

const CLARIFY_BLOCK_START = '[AAI_CLARIFY]';
const CLARIFY_BLOCK_END = '[/AAI_CLARIFY]';
const CHECKPOINT_SUMMARY_START = '[SESSION_CHECKPOINT]';
const CHECKPOINT_SUMMARY_END = '[/SESSION_CHECKPOINT]';
const HISTORY_SUMMARY_MAX_MESSAGES = 6;
const HISTORY_SUMMARY_MAX_CHARS = 260;

function uniqueList(items = []) {
  return [...new Set(items.filter(Boolean))];
}

export function compactHistoryMessage(content = '', maxChars = HISTORY_SUMMARY_MAX_CHARS) {
  const normalized = String(content || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return '-';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars - 3)}...`;
}

export function buildLastChatContext(historyRows = [], maxLines = 8) {
  if (!Array.isArray(historyRows) || historyRows.length === 0) return 'Belum ada riwayat chat sebelumnya.';

  const lines = historyRows
    .slice(-maxLines)
    .map((row, idx) => {
      const role = row.role === 'assistant' ? 'AI' : row.role === 'user' ? 'User' : 'System';
      return `${idx + 1}. [${role}] ${compactHistoryMessage(row.content, 180)}`;
    });

  return lines.join('\n');
}

export function buildIdentityContext(person = {}, currentAge = '?', familyContext = '', relationContext = '') {
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

export function buildConsistencyLock(person = {}, relevantSelection = {}) {
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

export function buildFinalContextBlock({
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

export function stripClarifyControlBlocks(text = '') {
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

export function extractCheckpointSummary(text = '') {
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

export function stripCheckpointControlBlocks(text = '') {
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

export function buildOlderHistorySummary(messages = []) {
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
