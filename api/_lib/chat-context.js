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

function detectEmotionalContext(message = '') {
  const normalized = String(message || '').toLowerCase();
  return /sedih|curhat|nangis|galau|kecewa|capek|stres|cemas|khawatir|takut|marah|kesal|bingung|putus\s+asa/.test(normalized);
}

function countMeaningfulSentences(text = '') {
  const chunks = String(text || '')
    .split(/[.!?\n]+/)
    .map(item => item.trim())
    .filter(Boolean);

  return chunks.filter(sentence => sentence.length >= 20).length;
}

export function analyzeClarifyBehavior(rawReply = '', visibleReply = '', userMessage = '') {
  const raw = String(rawReply || '');
  const visible = String(visibleReply || '').trim();
  const hadBlock = raw.includes(CLARIFY_BLOCK_START) && raw.includes(CLARIFY_BLOCK_END);
  const isEmotionalContext = detectEmotionalContext(userMessage);
  const meaningfulSentences = countMeaningfulSentences(visible);
  const hasActionStep = /(^|\n)\s*(\d+\.|[-*])\s+|langkah|step|pertama|kedua|ketiga|lakukan|coba|cek|gunakan|jalankan/i.test(visible);
  const isSubstantiveAnswer = meaningfulSentences >= 4 && (hasActionStep || visible.length >= 220);

  let reason = 'no_clarify_block';
  if (hadBlock && isEmotionalContext) reason = 'clarify_on_emotional_context';
  else if (hadBlock && !isSubstantiveAnswer) reason = 'clarify_without_substantive_answer';
  else if (hadBlock) reason = 'clarify_allowed';

  return {
    hadBlock,
    isEmotionalContext,
    meaningfulSentences,
    hasActionStep,
    isSubstantiveAnswer,
    allowMemoryWrite: !hadBlock,
    reason
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

/**
 * Builds a formatted context block for friends and their known information.
 * Injects friend names and their top memories into the system prompt.
 * 
 * @param {Array} friends - Array of { name, memories: [{key, value, type}, ...] }
 * @returns {string} Formatted friend context block or empty string if no friends
 */
export function buildFriendContextBlock(friends = []) {
  if (!Array.isArray(friends) || friends.length === 0) {
    // Return empty friends context so LLM knows the structure
    // This is IMPORTANT for friend suggestion detection to work on first conversation
    return [
      '[TEMAN-TEMAN YANG DIKENAL]',
      'Belum ada teman yang tersimpan dalam memori.',
      'Total teman dalam memori: 0',
      '',
      '⚠️ ATURAN TEMAN:',
      '1. Jika ada yang memperkenalkan diri sebagai teman baru (dengan pola "aku teman [nama pemilik]",',
      '   "namaku [X], aku teman [nama pemilik]", dll), WAJIB output tag [SUGGEST-FRIEND:...]',
      '2. Jangan ragukan — jika tak ada nama di list ini (karena list kosong), mereka adalah teman baru.'
    ].join('\n');
  }

  const validFriends = friends.filter(f => f && f.name);
  if (validFriends.length === 0) {
    return [
      '[TEMAN-TEMAN YANG DIKENAL]',
      'Belum ada teman yang tersimpan dalam memori.',
      'Total teman dalam memori: 0',
      '',
      '⚠️ ATURAN TEMAN:',
      '1. Jika ada yang memperkenalkan diri sebagai teman baru, WAJIB output tag [SUGGEST-FRIEND:...]',
      '2. Jangan ragukan — jika tak ada nama di list ini, mereka adalah teman baru.'
    ].join('\n');
  }

  // Prominent known-names list so the AI can quickly recognize returning friends
  const knownNamesList = validFriends.map(f => f.name).join(', ');

  const friendLines = validFriends
    .map(friend => {
      const memoriesText = friend.memories && Array.isArray(friend.memories)
        ? friend.memories
            .map(mem => `${mem.value || mem.key}`)
            .filter(Boolean)
            .join(', ')
        : 'Belum ada informasi tersimpan';

      return `- ${friend.name} (teman): ${memoriesText}`;
    });

  return [
    '[TEMAN-TEMAN YANG DIKENAL]',
    `NAMA YANG SUDAH DIKENAL: ${knownNamesList}`,
    `Total teman dalam memori: ${validFriends.length}`,
    ...friendLines,
    '',
    '⚠️ ATURAN TEMAN:',
    '1. Jika seseorang memperkenalkan diri dengan nama yang ADA di daftar atas, ia sudah dikenal.',
    '   → JANGAN output [SUGGEST-FRIEND:...]. Sambut dengan hangat + ceritakan apa yang kamu ingat.',
    '2. Jika seseorang tanya "apa kau ingat aku?" atau sejenisnya, cari namanya di daftar ini,',
    '   lalu ceritakan memorinya dengan detail. Jika tidak ada memori, akui dengan jujur.',
    '3. Hanya output [SUGGEST-FRIEND:...] jika nama BENAR-BENAR tidak ada di daftar ini.'
  ].join('\n');
}

/**
 * Fetches friend data for a given user/person.
 * Returns all friends (relation_type = 'teman' or 'sahabat') with their top memories.
 * 
 * @param {supabase} supabaseClient - Supabase client instance
 * @param {uuid} personId - Person ID to fetch friends for
 * @param {number} memoriesPerFriend - Max memories per friend (default 5)
 * @returns {Promise<Array>} Array of { name, memories: [...] }
 */
export async function fetchFriendsWithMemories(supabaseClient, personId, memoriesPerFriend = 5) {
  if (!personId) return [];

  try {
    // Get all friend relationships for this person.
    // Accept both 'active' and NULL friend_status (pre-migration records).
    let { data: relationships, error: relError } = await supabaseClient
      .from('relationships')
      .select('person_b, id')
      .eq('person_a', personId)
      .in('relation_type', ['teman', 'sahabat'])
      .or('friend_status.eq.active,friend_status.is.null');

    // Fallback: if the or() fails (column may not exist), retry without the filter
    if (relError) {
      const fallbackResult = await supabaseClient
        .from('relationships')
        .select('person_b, id')
        .eq('person_a', personId)
        .in('relation_type', ['teman', 'sahabat']);
      relationships = fallbackResult.data;
      relError = fallbackResult.error;
    }

    if (relError || !relationships?.length) {
      return [];
    }

    // Get person details and their top memories
    const friendIds = relationships.map(r => r.person_b);
    const { data: friendPersons } = await supabaseClient
      .from('persons')
      .select('id, name')
      .in('id', friendIds);

    if (!friendPersons?.length) {
      return [];
    }

    // Fetch top memories for each friend
    const friends = await Promise.all(
      friendPersons.map(async (friendPerson) => {
        const { data: memories } = await supabaseClient
          .from('person_memory')
          .select('id, key, value, memory_type, confidence, observation_count, priority_score')
          .eq('person_id', friendPerson.id)
          .eq('status', 'active')
          .order('priority_score', { ascending: false })
          .order('updated_at', { ascending: false })
          .limit(memoriesPerFriend);

        return {
          name: friendPerson.name,
          person_id: friendPerson.id,
          memories: memories || []
        };
      })
    );

    return friends.filter(f => f.name);
  } catch (err) {
    console.error('Error fetching friends with memories:', err);
    return [];
  }
}
