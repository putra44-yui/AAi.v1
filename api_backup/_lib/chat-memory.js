import { createHash } from 'node:crypto';
import { getLockedMemoryKeys } from '../../lib/lock-guard.js';

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

const MAX_MEMORY_CANDIDATES_PER_MESSAGE = 5;
const STRUCTURED_MEMORY_CATEGORY = 'meta_subject';
const PROVISIONAL_FRIEND_CATEGORY = 'provisional_friend';
const LEGACY_MEMORY_CATEGORY = 'warisan';
const ACTIVE_MEMORY_BUDGET = 70;
const DECAY_AFTER_DAYS = 14;
const DEFAULT_LEGACY_POOL_LIMIT = 120;
const DEFAULT_DYNAMIC_POOL_LIMIT = 90;
const LEGACY_ACCESS_LOOKBACK_DAYS = 30;
const MAX_WARISAN_RETRIEVAL_ROWS = 20;
const FIRST_PERSON_REGEX = /\b(aku|saya|gue|gw|gua|diriku|aku\s+lagi|aku\s+suka|aku\s+ngerasa|aku\s+merasa)\b/i;
const TOPIC_SHIFT_REGEX = /^(?:selain\s+itu|di\s+sisi\s+lain|ngomong-ngomong|omong-omong|btw|by\s+the\s+way|lalu|terus|sementara\s+itu|soal\s+lain|topik\s+lain)\b/i;
const NAME_STOPWORDS = new Set([
  'lagi',
  'sedang',
  'masih',
  'baru',
  'yang',
  'dan',
  'kalau',
  'karena',
  'suka',
  'gak',
  'nggak',
  'tidak',
  'mau',
  'ingin',
  'punya',
  'butuh',
  'kerja',
  'kuliah',
  'latsar',
  'capek',
  'sedih',
  'marah',
  'senang',
  'cemas',
  'lagi-lagi'
]);
const RELATION_PATTERN_DEFINITIONS = [
  { relation: 'teman', regex: /\bteman(?:ku|\s+saya|\s+kami)?\s+([^,.!?;\n]+)/gi },
  { relation: 'sahabat', regex: /\bsahabat(?:ku|\s+saya)?\s+([^,.!?;\n]+)/gi },
  { relation: 'istri', regex: /\bistri(?:ku)?\s+([^,.!?;\n]+)/gi },
  { relation: 'suami', regex: /\bsuami(?:ku)?\s+([^,.!?;\n]+)/gi },
  { relation: 'anak', regex: /\banak(?:ku)?\s+([^,.!?;\n]+)/gi },
  { relation: 'ayah', regex: /\b(?:ayah|abi|bapak|papa)(?:ku)?\s+([^,.!?;\n]+)/gi },
  { relation: 'ibu', regex: /\b(?:ibu|ummi|mama|bunda)(?:ku)?\s+([^,.!?;\n]+)/gi },
  { relation: 'kakak', regex: /\bkakak(?:ku)?\s+([^,.!?;\n]+)/gi },
  { relation: 'adik', regex: /\badik(?:ku)?\s+([^,.!?;\n]+)/gi }
];
const RELATION_ALIAS_MAP = Object.freeze({
  diri: ['aku', 'saya', 'gue', 'gw', 'gua', 'diriku'],
  teman: ['teman', 'temanku'],
  sahabat: ['sahabat', 'sahabatku'],
  istri: ['istri', 'istriku'],
  suami: ['suami', 'suamiku'],
  anak: ['anak', 'anakku', 'anaknya'],
  ayah: ['ayah', 'ayahku', 'abi', 'abiku', 'bapak', 'bapakku', 'papa', 'papaku'],
  ibu: ['ibu', 'ibuku', 'ummi', 'ummiku', 'mama', 'mamaku', 'bunda', 'bundaku'],
  kakak: ['kakak', 'kakakku'],
  adik: ['adik', 'adikku'],
  keluarga: ['keluarga']
});
const GENERIC_RELATION_ALIAS_SET = new Set(Object.values(RELATION_ALIAS_MAP)
  .flatMap((aliases) => aliases)
  .map(alias => String(alias || '').trim().toLowerCase())
  .filter(Boolean));
const NESTED_RELATION_TARGET_PATTERN = '(?:teman(?:ku|\\s+saya|\\s+kami)?|sahabat(?:ku|\\s+saya)?|istri(?:ku)?|suami(?:ku)?|anak(?:ku)?|(?:ayah|abi|bapak|papa)(?:ku)?|(?:ibu|ummi|mama|bunda)(?:ku)?|kakak(?:ku)?|adik(?:ku)?)';
const NESTED_RELATION_HEAD_ALIASES = Object.freeze([
  'istri',
  'suami',
  'anak',
  'ayah',
  'ibu',
  'kakak',
  'adik'
]);
const REFERENCE_NAME_STOPWORDS = new Set([
  ...NAME_STOPWORDS,
  'dulu',
  'saat',
  'ketika',
  'waktu',
  'tadi',
  'barusan',
  'semalam',
  'kemarin',
  'besok',
  'nanti',
  'hari',
  'minggu',
  'bulan',
  'tahun',
  'ini',
  'itu',
  'sini',
  'situ',
  'lama',
  'sudah',
  'udah',
  'pernah',
  'belum'
]);

const lifecycleRuns = new Map();
const DEFAULT_CHECKPOINT_METADATA = Object.freeze({
  active_subjects: [],
  pending_provisional: [],
  last_intent: 'general',
  token_usage_estimate: 0
});

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
}

function compactText(value = '', maxChars = 180) {
  const normalized = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) return '';
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function toSlug(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function escapeRegex(value = '') {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getRelationAliases(relation = '') {
  const normalizedRelation = normalizeMemoryText(relation).replace(/\s+/g, '_');
  if (!normalizedRelation) return [];
  return uniqueList((RELATION_ALIAS_MAP[normalizedRelation] || [normalizedRelation])
    .map(alias => normalizeMemoryText(alias))
    .filter(Boolean));
}

function matchesTextAlias(text = '', alias = '') {
  const normalizedText = normalizeMemoryText(text);
  const normalizedAlias = normalizeMemoryText(alias);
  if (!normalizedText || !normalizedAlias) return false;
  return new RegExp(`(^|\\b)${escapeRegex(normalizedAlias)}(\\b|$)`, 'i').test(normalizedText);
}

function isNestedRelationAliasUsage(text = '', alias = '') {
  const normalizedText = normalizeMemoryText(text);
  const normalizedAlias = normalizeMemoryText(alias);
  if (!normalizedText || !normalizedAlias) return false;
  if (!GENERIC_RELATION_ALIAS_SET.has(normalizedAlias)) return false;

  return new RegExp(`(^|\\b)${escapeRegex(normalizedAlias)}\\s+(?:dari\\s+)?${NESTED_RELATION_TARGET_PATTERN}(\\b|$)`, 'i')
    .test(normalizedText);
}

function findKnownEntryMatch(text = '', knownEntries = []) {
  const normalizedText = normalizeMemoryText(text);
  if (!normalizedText) return null;

  const matches = [];
  for (const entry of Array.isArray(knownEntries) ? knownEntries : []) {
    if (!entry?.normalized) continue;

    const aliases = uniqueList([entry.normalized, ...(entry.aliases || [])])
      .map(alias => normalizeMemoryText(alias))
      .filter(Boolean);

    for (const alias of aliases) {
      if (!alias) continue;
      if (alias !== entry.normalized && GENERIC_RELATION_ALIAS_SET.has(alias)) continue;
      if (!matchesTextAlias(normalizedText, alias)) continue;

      matches.push({
        entry,
        alias,
        exact: normalizedText === alias ? 1 : 0,
        prefix: new RegExp(`^${escapeRegex(alias)}(\\b|$)`, 'i').test(normalizedText) ? 1 : 0,
        aliasLength: alias.length
      });
    }
  }

  return matches.sort((left, right) => {
    if (right.exact !== left.exact) return right.exact - left.exact;
    if (right.prefix !== left.prefix) return right.prefix - left.prefix;
    return right.aliasLength - left.aliasLength;
  })[0] || null;
}

function extractLeadingReferenceSubject(text = '') {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;

  const tokens = raw.split(' ').filter(Boolean);
  if (tokens.length === 0) return null;

  const firstToken = normalizeMemoryText(tokens[0] || '');
  if (!firstToken || REFERENCE_NAME_STOPWORDS.has(firstToken) || GENERIC_RELATION_ALIAS_SET.has(firstToken)) {
    return null;
  }

  const subjectSamples = uniqueList([
    tokens.slice(0, 2).join(' '),
    tokens[0]
  ].map(sample => sample.trim()).filter(Boolean));

  for (const sample of subjectSamples) {
    const subject = normalizeDetectedName(sample);
    if (!subject) continue;

    const normalizedSubject = normalizeMemoryText(subject);
    const firstSubjectToken = normalizedSubject.split(' ').filter(Boolean)[0] || '';
    if (!firstSubjectToken || REFERENCE_NAME_STOPWORDS.has(firstSubjectToken)) continue;

    return {
      subject,
      normalized: normalizedSubject,
      matchedText: subject
    };
  }

  return null;
}

function extractRelationTargetSubject(text = '', knownEntries = []) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;

  const knownMatch = findKnownEntryMatch(raw, knownEntries);
  if (knownMatch?.entry) {
    return {
      subject: knownMatch.entry.name,
      normalized: knownMatch.entry.normalized,
      knownEntry: knownMatch.entry
    };
  }

  const tokens = raw.split(' ').filter(Boolean);
  if (tokens.length === 0) return null;

  const firstTokenRaw = tokens[0].replace(/[^a-zA-Z\-']/g, '');
  const firstToken = normalizeMemoryText(firstTokenRaw);
  if (!firstToken || REFERENCE_NAME_STOPWORDS.has(firstToken)) return null;

  const secondTokenOriginal = tokens[1] || '';
  const secondTokenRaw = secondTokenOriginal.replace(/[^a-zA-Z\-']/g, '');
  const secondToken = normalizeMemoryText(secondTokenRaw);
  const useSecondToken = Boolean(
    secondTokenRaw
    && !REFERENCE_NAME_STOPWORDS.has(secondToken)
    && /^[A-Z][a-zA-Z\-']*$/.test(secondTokenOriginal)
  );

  const subjectSample = useSecondToken
    ? `${firstTokenRaw} ${secondTokenRaw}`.trim()
    : firstTokenRaw;
  const subject = normalizeDetectedName(subjectSample);
  if (!subject) return null;

  return {
    subject,
    normalized: normalizeMemoryText(subject),
    knownEntry: null
  };
}

function resolveNestedRelationBaseReference(text = '', knownEntries = [], options = {}) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;

  const currentPersonName = titleCaseName(options.currentPersonName || '');
  const explicitCandidates = [];
  for (const definition of RELATION_PATTERN_DEFINITIONS) {
    definition.regex.lastIndex = 0;
    const match = definition.regex.exec(raw);
    if (!match) continue;

    const extractedSubject = extractRelationTargetSubject(match[1] || '', knownEntries);
    if (!extractedSubject?.subject) continue;

    const subject = extractedSubject.subject;
    const normalized = extractedSubject.normalized;
    const knownEntry = extractedSubject.knownEntry || null;
    const relationPrefix = String(match[0] || '').replace(String(match[1] || ''), '').trim();

    explicitCandidates.push({
      subject: knownEntry?.name || subject,
      normalized,
      relation: knownEntry?.relation || definition.relation,
      known: Boolean(knownEntry),
      isCurrentUser: Boolean(currentPersonName && normalizeMemoryText(currentPersonName) === normalized),
      matchedText: compactText([relationPrefix, knownEntry?.name || subject].filter(Boolean).join(' '), 120),
      matchedEntry: knownEntry
    });
  }

  if (explicitCandidates.length > 0) {
    return explicitCandidates.sort((left, right) => {
      if (right.known !== left.known) return Number(right.known) - Number(left.known);
      return right.subject.length - left.subject.length;
    })[0];
  }

  const knownMatch = findKnownEntryMatch(raw, knownEntries);
  if (knownMatch?.entry) {
    return {
      subject: knownMatch.entry.name,
      normalized: knownMatch.entry.normalized,
      relation: knownMatch.entry.relation || detectRelationForSubject(raw, knownMatch.entry.name),
      known: true,
      isCurrentUser: Boolean(currentPersonName && normalizeMemoryText(currentPersonName) === knownMatch.entry.normalized),
      matchedText: knownMatch.entry.name,
      matchedEntry: knownMatch.entry
    };
  }

  const leadingSubject = extractLeadingReferenceSubject(raw);
  if (!leadingSubject?.subject) return null;

  return {
    subject: leadingSubject.subject,
    normalized: leadingSubject.normalized,
    relation: detectRelationForSubject(raw, leadingSubject.subject),
    known: false,
    isCurrentUser: Boolean(currentPersonName && normalizeMemoryText(currentPersonName) === leadingSubject.normalized),
    matchedText: leadingSubject.matchedText,
    matchedEntry: null
  };
}

function findFamilyEntryByReference(reference = {}, familyMembers = []) {
  const normalizedReference = normalizeMemoryText(reference?.normalized || reference?.subject || '');
  if (!normalizedReference) return null;

  return (Array.isArray(familyMembers) ? familyMembers : []).find(entry => {
    if (!entry?.name) return false;
    if (reference?.matchedEntry?.id && entry.id && reference.matchedEntry.id === entry.id) return true;
    return normalizeMemoryText(entry.name) === normalizedReference;
  }) || null;
}

function pickSingleFamilyEntryByRelation(familyMembers = [], relation = '') {
  const normalizedRelation = normalizeRelation(relation || '');
  if (!normalizedRelation) return null;

  const matches = (Array.isArray(familyMembers) ? familyMembers : [])
    .filter(entry => normalizeRelation(entry?.relation || '') === normalizedRelation);

  return matches.length === 1 ? matches[0] : null;
}

function resolveCanonicalFamilyNestedTarget(outerRelation = '', baseReference = {}, familyMembers = []) {
  const normalizedOuterRelation = normalizeRelation(outerRelation || '');
  const baseFamilyEntry = findFamilyEntryByReference(baseReference, familyMembers);
  const baseRelation = normalizeRelation(baseFamilyEntry?.relation || '');

  if (!normalizedOuterRelation || !baseFamilyEntry || !baseRelation) return null;

  if (normalizedOuterRelation === 'istri' && baseRelation === 'ayah') {
    return pickSingleFamilyEntryByRelation(familyMembers, 'ibu');
  }

  if (normalizedOuterRelation === 'suami' && baseRelation === 'ibu') {
    return pickSingleFamilyEntryByRelation(familyMembers, 'ayah');
  }

  if (normalizedOuterRelation === 'ayah' && baseRelation === 'anak') {
    return pickSingleFamilyEntryByRelation(familyMembers, 'ayah');
  }

  if (normalizedOuterRelation === 'ibu' && baseRelation === 'anak') {
    return pickSingleFamilyEntryByRelation(familyMembers, 'ibu');
  }

  if (normalizedOuterRelation === 'anak' && ['ayah', 'ibu'].includes(baseRelation)) {
    return pickSingleFamilyEntryByRelation(familyMembers, 'anak');
  }

  return null;
}

function buildNestedRelationCandidate(text = '', knownEntries = [], options = {}) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;

  const currentPersonName = titleCaseName(options.currentPersonName || '');
  const familyMembers = Array.isArray(options.familyMembers) ? options.familyMembers : [];
  const candidates = [];

  for (const headAlias of NESTED_RELATION_HEAD_ALIASES) {
    const pattern = new RegExp(`(^|\\b)(${escapeRegex(headAlias)})\\s+(?:dari\\s+)?([^,.!?;\\n]+)`, 'ig');
    let match;
    while ((match = pattern.exec(raw)) !== null) {
      const baseReference = resolveNestedRelationBaseReference(match[3] || '', knownEntries, {
        currentPersonName
      });
      if (!baseReference?.subject) continue;

      const canonicalTarget = resolveCanonicalFamilyNestedTarget(headAlias, baseReference, familyMembers);
      const subject = canonicalTarget?.name || titleCaseName(`${normalizeRelation(headAlias) || headAlias} ${baseReference.subject}`);
      const normalized = normalizeMemoryText(subject);
      if (!normalized) continue;

      candidates.push({
        subject,
        normalized,
        relation: canonicalTarget?.relation || normalizeRelation(headAlias),
        known: Boolean(canonicalTarget?.id),
        explicit: true,
        isCurrentUser: Boolean(currentPersonName && normalizeMemoryText(currentPersonName) === normalized),
        nestedRelation: true,
        canonicalTarget: Boolean(canonicalTarget?.id),
        derivedFromKnownSubject: Boolean(baseReference.known || canonicalTarget?.id),
        parentSubject: baseReference.subject,
        parentRelation: baseReference.relation || null,
        headAliases: [normalizeMemoryText(match[2] || headAlias)],
        referencePrefixes: uniqueList([
          compactText(`${match[2] || headAlias} ${baseReference.matchedText || baseReference.subject}`.replace(/\s+/g, ' ').trim(), 120)
        ].filter(Boolean)),
        source_context: canonicalTarget?.id || baseReference.known
          ? 'friend_via_account'
          : 'ai_inference'
      });
    }
  }

  if (candidates.length === 0) return null;

  return candidates.sort((left, right) => {
    if (right.canonicalTarget !== left.canonicalTarget) return Number(right.canonicalTarget) - Number(left.canonicalTarget);
    if (right.derivedFromKnownSubject !== left.derivedFromKnownSubject) return Number(right.derivedFromKnownSubject) - Number(left.derivedFromKnownSubject);
    return (right.referencePrefixes?.[0] || '').length - (left.referencePrefixes?.[0] || '').length;
  })[0];
}

function titleCaseName(value = '') {
  return String(value || '')
    .split(/\s+/)
    .filter(Boolean)
    .map(token => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
    .join(' ')
    .trim();
}

function safeJsonParse(value = '') {
  const raw = String(value || '').trim();
  if (!raw || !raw.startsWith('{') || !raw.endsWith('}')) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function looksLikeStructuredJson(value = '') {
  const raw = String(value || '').trim();
  return raw.startsWith('{') || raw.startsWith('[');
}

function normalizeCheckpointList(items = [], maxItems = 12) {
  return uniqueList((Array.isArray(items) ? items : [])
    .map(item => compactText(String(item || '').trim(), 80))
    .filter(Boolean))
    .slice(0, Math.max(0, maxItems));
}

function normalizePendingProvisional(items = []) {
  return (Array.isArray(items) ? items : [])
    .map(item => {
      if (!item) return null;
      if (typeof item === 'string') {
        return {
          key: normalizeMemoryKey(item),
          subject: titleCaseName(String(item || '').replace(/^mention_/, '').replace(/_/g, ' ')),
          mention_count: 1
        };
      }

      return {
        key: normalizeMemoryKey(item.key || ''),
        subject: titleCaseName(item.subject || item.name || ''),
        mention_count: Math.max(1, Number(item.mention_count || 1))
      };
    })
    .filter(item => item && (item.key || item.subject))
    .slice(0, 5);
}

function normalizeDetectedName(value = '') {
  const raw = String(value || '')
    .replace(/[()[\]{}"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!raw) return '';

  const tokens = raw
    .split(' ')
    .map(token => token.replace(/[^a-zA-Z\-']/g, ''))
    .filter(Boolean);

  const accepted = [];
  for (const token of tokens) {
    const normalizedToken = normalizeMemoryText(token);
    if (!normalizedToken || NAME_STOPWORDS.has(normalizedToken)) break;
    accepted.push(token);
    if (accepted.length >= 3) break;
  }

  return titleCaseName(accepted.join(' '));
}

function buildKnownEntityEntries(items = [], fallbackRelation = null) {
  const entries = [];

  for (const item of Array.isArray(items) ? items : []) {
    if (!item) continue;

    const name = typeof item === 'string'
      ? item
      : (item.name || item.subject || '');
    const normalizedName = normalizeDetectedName(name);
    if (!normalizedName) continue;

    const relation = normalizeRelation(typeof item === 'string'
      ? fallbackRelation
      : (item.relation || item.role || fallbackRelation));
    const rawAliases = typeof item === 'string'
      ? []
      : (Array.isArray(item.aliases)
          ? item.aliases
          : (item.aliases ? [item.aliases] : []));

    entries.push({
      id: typeof item === 'string' ? null : (item.id || null),
      name: normalizedName,
      normalized: normalizeMemoryText(normalizedName),
      relation,
      aliases: uniqueList([
        ...rawAliases.map(alias => normalizeMemoryText(alias)),
        ...getRelationAliases(relation)
      ].filter(Boolean)),
      known: true
    });
  }

  const deduped = new Map();
  for (const entry of entries) {
    if (!entry.normalized || deduped.has(entry.normalized)) continue;
    deduped.set(entry.normalized, entry);
  }

  return [...deduped.values()];
}

export function normalizeSourceContext(input = '') {
  const normalized = String(input || '').trim().toLowerCase();
  if (normalized === 'user_direct') return 'user_direct';
  if (normalized === 'friend_via_account') return 'friend_via_account';
  return 'ai_inference';
}

export function normalizeRelation(input = '') {
  const normalized = normalizeMemoryText(input).replace(/\s+/g, '_');
  if (!normalized) return null;

  const relationMap = {
    self: 'diri',
    diri: 'diri',
    aku: 'diri',
    saya: 'diri',
    gue: 'diri',
    gw: 'diri',
    gua: 'diri',
    teman: 'teman',
    sahabat: 'sahabat',
    istri: 'istri',
    suami: 'suami',
    anak: 'anak',
    anakku: 'anak',
    ayah: 'ayah',
    ayahku: 'ayah',
    abi: 'ayah',
    abiku: 'ayah',
    bapak: 'ayah',
    bapakku: 'ayah',
    papa: 'ayah',
    papaku: 'ayah',
    ibu: 'ibu',
    ibuku: 'ibu',
    ummi: 'ibu',
    ummiku: 'ibu',
    mama: 'ibu',
    mamaku: 'ibu',
    bunda: 'ibu',
    bundaku: 'ibu',
    kakak: 'kakak',
    adik: 'adik',
    keluarga: 'keluarga'
  };

  return relationMap[normalized] || normalized;
}

function normalizeStructuredMemoryPayload(payload = {}, options = {}) {
  const subject = titleCaseName(payload.subject || payload.name || options.subject || '');
  const rawValue = String(payload.value || payload.statement || payload.context || options.fallbackValue || '').trim();
  const semanticCategory = String(payload.semantic_category || payload.memory_category || options.semanticCategory || 'umum')
    .trim()
    .toLowerCase()
    .slice(0, 60) || 'umum';

  const normalized = {
    subject,
    relation: normalizeRelation(payload.relation || options.relation || ''),
    value: compactText(rawValue, 220),
    source_context: normalizeSourceContext(payload.source_context || options.sourceContext || ''),
    face_id_hint: payload.face_id_hint ?? null,
    cctv_ready: Boolean(payload.cctv_ready),
    semantic_category: semanticCategory
  };

  if (payload.status) normalized.status = String(payload.status).trim().toLowerCase();
  if (payload.first_seen) normalized.first_seen = String(payload.first_seen);
  if (payload.last_seen) normalized.last_seen = String(payload.last_seen);
  if (payload.context && !normalized.value) normalized.value = compactText(String(payload.context), 220);

  const mentionCount = Number(payload.mention_count ?? options.mentionCount ?? 0);
  if (Number.isFinite(mentionCount) && mentionCount > 0) {
    normalized.mention_count = Math.max(1, Math.floor(mentionCount));
  }

  return normalized;
}

export function safeParseValue(input = '', options = {}) {
  const rawValue = input && typeof input === 'object' && !Array.isArray(input)
    ? (input.value ?? input.memory_value ?? '')
    : input;
  const fallbackValue = String(rawValue || options.fallbackValue || '').trim();
  const parsedRaw = input && typeof input === 'object' && !Array.isArray(input)
    ? safeJsonParse(rawValue)
    : safeJsonParse(fallbackValue);
  const parsed = parsedRaw
    ? normalizeStructuredMemoryPayload(parsedRaw, {
        fallbackValue,
        semanticCategory: input && typeof input === 'object' && !Array.isArray(input)
          ? (input.category || options.semanticCategory || 'umum')
          : (options.semanticCategory || 'umum')
      })
    : null;
  const fallbackCategory = String(
    (input && typeof input === 'object' && !Array.isArray(input)
      ? input.category
      : options.semanticCategory) || 'umum'
  ).trim().toLowerCase().slice(0, 60) || 'umum';

  return {
    raw: fallbackValue,
    parsed,
    value: parsed?.value || fallbackValue,
    subject: parsed?.subject || '',
    relation: parsed?.relation || null,
    source_context: parsed?.source_context || null,
    face_id_hint: parsed?.face_id_hint ?? null,
    cctv_ready: Boolean(parsed?.cctv_ready),
    semantic_category: parsed?.semantic_category || fallbackCategory,
    status: parsed?.status || null,
    mention_count: Number(parsed?.mention_count || 0),
    first_seen: parsed?.first_seen || null,
    last_seen: parsed?.last_seen || null,
    fallback_legacy: !parsed,
    corrupted_json: Boolean(fallbackValue && looksLikeStructuredJson(fallbackValue) && !parsed)
  };
}

export function parseStructuredMemoryValue(input = '') {
  if (input && typeof input === 'object' && !Array.isArray(input) && !('value' in input) && !('memory_value' in input)) {
    return normalizeStructuredMemoryPayload(input);
  }

  return safeParseValue(input).parsed;
}

export function stringifyStructuredMemoryValue(payload = {}, fallbackValue = '') {
  const normalized = normalizeStructuredMemoryPayload(payload, { fallbackValue });
  if (!normalized.subject && !normalized.value) {
    return String(fallbackValue || '').trim();
  }
  return JSON.stringify(normalized);
}

export function isLegacyCategory(input = '') {
  return String(input || '').trim().toLowerCase() === LEGACY_MEMORY_CATEGORY;
}

export function isLegacyMemory(memory = {}) {
  return isLegacyCategory(memory.category || '')
    || String(memory.memory_scope || memory.scope || '').trim().toLowerCase() === 'legacy';
}

export function extractStructuredMemoryMetadata(memory = {}) {
  const valueState = safeParseValue(memory);

  return {
    parsed: valueState.parsed,
    subject: valueState.subject,
    relation: valueState.relation,
    value: valueState.value,
    source_context: valueState.source_context,
    face_id_hint: valueState.face_id_hint,
    cctv_ready: valueState.cctv_ready,
    semantic_category: valueState.semantic_category,
    status: valueState.status,
    mention_count: valueState.mention_count,
    first_seen: valueState.first_seen,
    last_seen: valueState.last_seen,
    fallback_legacy: valueState.fallback_legacy,
    corrupted_json: valueState.corrupted_json
  };
}

function collectActiveSubjectsFromMemories(memories = []) {
  return normalizeCheckpointList((Array.isArray(memories) ? memories : [])
    .map(memory => extractStructuredMemoryMetadata(memory).subject)
    .filter(Boolean), 12);
}

function collectPendingProvisionalFromMemories(memories = []) {
  return normalizePendingProvisional((Array.isArray(memories) ? memories : [])
    .filter(memory => String(memory?.category || '').trim().toLowerCase() === PROVISIONAL_FRIEND_CATEGORY)
    .map(memory => {
      const metadata = extractStructuredMemoryMetadata(memory || {});
      return {
        key: memory?.key || '',
        subject: metadata.subject || '',
        mention_count: metadata.mention_count || Number(memory?.observation_count || 1)
      };
    }));
}

function normalizeCheckpointMetadata(metadata = {}, memories = []) {
  return {
    active_subjects: normalizeCheckpointList(metadata.active_subjects || collectActiveSubjectsFromMemories(memories), 12),
    pending_provisional: normalizePendingProvisional(metadata.pending_provisional || collectPendingProvisionalFromMemories(memories)),
    last_intent: compactText(String(metadata.last_intent || 'general').trim() || 'general', 48),
    token_usage_estimate: Math.max(0, Math.round(Number(metadata.token_usage_estimate || 0)))
  };
}

export function safeParseCheckpointSummary(input = '') {
  const raw = String(input || '').trim();
  if (!raw) {
    return {
      raw: '',
      summary: '',
      metadata: { ...DEFAULT_CHECKPOINT_METADATA },
      fallback_legacy: false
    };
  }

  const parsed = safeJsonParse(raw);
  if (!parsed || (typeof parsed.summary !== 'string' && typeof parsed.checkpoint_summary !== 'string')) {
    return {
      raw,
      summary: raw,
      metadata: { ...DEFAULT_CHECKPOINT_METADATA },
      fallback_legacy: true
    };
  }

  const summary = compactText(String(parsed.summary || parsed.checkpoint_summary || '').trim(), 2600);
  return {
    raw,
    summary,
    metadata: normalizeCheckpointMetadata(parsed.metadata || parsed, []),
    fallback_legacy: false
  };
}

export function stringifyCheckpointSummary({
  summary = '',
  memories = [],
  metadata = {},
  lastIntent = '',
  tokenUsageEstimate = 0
} = {}) {
  const normalizedSummary = compactText(String(summary || '').trim(), 2600);
  if (!normalizedSummary) return '';

  return JSON.stringify({
    version: 2,
    summary: normalizedSummary,
    metadata: normalizeCheckpointMetadata({
      ...metadata,
      last_intent: lastIntent || metadata.last_intent || 'general',
      token_usage_estimate: tokenUsageEstimate || metadata.token_usage_estimate || 0,
      active_subjects: metadata.active_subjects || collectActiveSubjectsFromMemories(memories),
      pending_provisional: metadata.pending_provisional || collectPendingProvisionalFromMemories(memories)
    }, memories)
  });
}

function buildMemorySearchText(memory = {}) {
  const metadata = extractStructuredMemoryMetadata(memory);
  return [
    memory.key,
    metadata.subject,
    metadata.relation,
    metadata.value,
    metadata.semantic_category,
    memory.memory_type,
    memory.category
  ]
    .map(part => normalizeMemoryText(part || ''))
    .filter(Boolean)
    .join(' ')
    .trim();
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
  if (isLegacyMemory(memory)) return 'stable';

  const normalizedKey = normalizeMemoryKey(memory.key || memory.memory_key || '');
  const normalizedType = normalizeMemoryType(memory.memoryType || memory.memory_type || 'fakta');
  const metadata = extractStructuredMemoryMetadata(memory);

  if (isLegacyCategory(metadata.semantic_category)) return 'stable';

  if (normalizedType === 'cara_berpikir') return 'stable';
  if (STABLE_MEMORY_KEYS.has(normalizedKey)) return 'stable';

  if (normalizedType === 'pattern' && STABLE_PATTERN_HINTS.some(token => normalizedKey.includes(token))) {
    return 'stable';
  }

  return 'dynamic';
}

export function buildMemoryClaimHash(memory = {}) {
  const metadata = extractStructuredMemoryMetadata(memory);
  const normalizedKey = normalizeMemoryKey(memory.key || memory.memory_key || '');
  const normalizedType = normalizeMemoryType(memory.memoryType || memory.memory_type || 'fakta');
  const normalizedValue = normalizeMemoryText(metadata.value || memory.value || memory.memory_value || '');
  const normalizedSubject = normalizeMemoryText(metadata.subject || '');
  const normalizedRelation = normalizeMemoryText(metadata.relation || '');
  const normalizedCategory = normalizeMemoryText(metadata.semantic_category || memory.category || 'umum');
  return hashText([
    normalizedType,
    normalizedKey,
    normalizedValue,
    normalizedSubject,
    normalizedRelation,
    normalizedCategory
  ].join('|'));
}

function buildEvidenceBucket(sessionId = '', createdAt = null) {
  if (sessionId) return `session:${String(sessionId).trim()}`;

  const date = createdAt ? new Date(createdAt) : new Date();
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return `hour:${safeDate.toISOString().slice(0, 13)}`;
}

function summarizeContextText(input = '', options = {}) {
  const headTokens = Math.max(1, Number(options.headTokens || 18));
  const tailTokens = Math.max(1, Number(options.tailTokens || 18));
  const maxChars = Math.max(40, Number(options.maxChars || 240));
  const normalized = normalizeMemoryText(input);
  if (!normalized) return '';

  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0) return '';

  let summary = tokens.join(' ');
  if (tokens.length > headTokens + tailTokens) {
    summary = `${tokens.slice(0, headTokens).join(' ')} ... ${tokens.slice(-tailTokens).join(' ')}`;
  }

  return compactText(summary, maxChars);
}

function buildEvidenceContextSummary(userMessage = '', recentHistory = []) {
  const currentSummary = summarizeContextText(userMessage, {
    headTokens: 22,
    tailTokens: 22,
    maxChars: 320
  });
  const historySummary = (Array.isArray(recentHistory) ? recentHistory : [])
    .slice(-4)
    .map(row => {
      const role = String(row?.role || '').trim().toLowerCase();
      const roleLabel = role === 'assistant'
        ? 'assistant'
        : role === 'user'
          ? 'user'
          : 'system';
      const textSummary = summarizeContextText(row?.content || '', {
        headTokens: 12,
        tailTokens: 12,
        maxChars: 180
      });
      return textSummary ? `${roleLabel}: ${textSummary}` : '';
    })
    .filter(Boolean)
    .join(' | ');

  return [
    currentSummary ? `current: ${currentSummary}` : '',
    historySummary ? `recent: ${historySummary}` : ''
  ].filter(Boolean).join(' || ');
}

function buildEvidenceContextWindow(userMessage = '', recentHistory = []) {
  const currentMessage = String(userMessage || '').trim();
  const recentTurns = (Array.isArray(recentHistory) ? recentHistory : [])
    .slice(-6)
    .map(row => ({
      role: String(row?.role || '').trim().toLowerCase() || 'unknown',
      content: String(row?.content || '').trim()
    }))
    .filter(turn => turn.content);
  const summary = buildEvidenceContextSummary(currentMessage, recentTurns);

  if (!currentMessage && recentTurns.length === 0 && !summary) return '';

  return JSON.stringify({
    version: 2,
    summary,
    current_message: currentMessage,
    recent_turns: recentTurns
  });
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
  const metadata = extractStructuredMemoryMetadata(memory);

  return {
    person_id: personId || null,
    memory_id: memoryId || null,
    memory_key: normalizeMemoryKey(memory.key || memory.memory_key || ''),
    memory_type: normalizeMemoryType(memory.memoryType || memory.memory_type || 'fakta'),
    memory_value: String(metadata.value || memory.value || memory.memory_value || '').trim(),
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

function detectRelationForSubject(text = '', subject = '') {
  const raw = String(text || '').trim();
  if (!raw) return null;
  if (FIRST_PERSON_REGEX.test(raw)) return 'diri';

  const subjectPattern = subject ? escapeRegex(String(subject).toLowerCase()) : '';
  const ayahPattern = '(?:ayah|abi|bapak|papa)(?:ku)?';
  const ibuPattern = '(?:ibu|ummi|mama|bunda)(?:ku)?';
  const relationChecks = [
    ['sahabat', subjectPattern ? new RegExp(`sahabat(?:ku|\\s+saya)?\\s+${subjectPattern}`, 'i') : /\bsahabat\b/i],
    ['teman', subjectPattern ? new RegExp(`teman(?:ku|\\s+saya|\\s+kami)?\\s+${subjectPattern}`, 'i') : /\bteman\b/i],
    ['istri', subjectPattern ? new RegExp(`istri(?:ku)?\\s+${subjectPattern}`, 'i') : /\bistri\b/i],
    ['suami', subjectPattern ? new RegExp(`suami(?:ku)?\\s+${subjectPattern}`, 'i') : /\bsuami\b/i],
    ['anak', subjectPattern ? new RegExp(`anak(?:ku)?\\s+${subjectPattern}`, 'i') : /\banak\b/i],
    ['ayah', subjectPattern ? new RegExp(`${ayahPattern}\\s+${subjectPattern}`, 'i') : /\b(?:ayah|abi|bapak|papa)\b/i],
    ['ibu', subjectPattern ? new RegExp(`${ibuPattern}\\s+${subjectPattern}`, 'i') : /\b(?:ibu|ummi|mama|bunda)\b/i],
    ['kakak', subjectPattern ? new RegExp(`kakak(?:ku)?\\s+${subjectPattern}`, 'i') : /\bkakak\b/i],
    ['adik', subjectPattern ? new RegExp(`adik(?:ku)?\\s+${subjectPattern}`, 'i') : /\badik\b/i]
  ];

  for (const [relation, regex] of relationChecks) {
    if (regex.test(raw.toLowerCase())) return relation;
  }

  return null;
}

function detectLeadingSubject(text = '') {
  const tokens = String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

  if (tokens.length < 2) return '';
  if (FIRST_PERSON_REGEX.test(tokens[0])) return '';

  const first = normalizeDetectedName(tokens[0]);
  const second = normalizeDetectedName(tokens.slice(0, 2).join(' '));
  const nextToken = normalizeMemoryText(tokens[1]);
  const thirdToken = normalizeMemoryText(tokens[2] || '');

  if (!first) return '';
  if (['lagi', 'sedang', 'masih', 'baru', 'suka', 'kerja', 'kuliah', 'latsar', 'butuh', 'mau', 'ingin', 'capek', 'sedih', 'marah', 'senang', 'cemas'].includes(nextToken)) {
    return first;
  }
  if (second && ['lagi', 'sedang', 'masih', 'baru', 'suka', 'kerja', 'kuliah', 'latsar'].includes(thirdToken)) {
    return second;
  }

  return '';
}

function resolveSemanticCategory(segmentText = '', intentAnalysis = {}, rawCandidate = {}) {
  const explicitCategory = String(rawCandidate.category || '').trim().toLowerCase();
  if (explicitCategory && explicitCategory !== 'umum') return explicitCategory.slice(0, 60);

  if (intentAnalysis.intent === 'relasi') return 'relasi';
  if (intentAnalysis.intent === 'emosi') return 'emosi';
  if (intentAnalysis.intent === 'preferensi') return 'preferensi';
  if (intentAnalysis.intent === 'kebiasaan') return 'kebiasaan';
  if (intentAnalysis.intent === 'kepribadian') return 'cara_berpikir';
  if (/latsar|kuliah|kerja|proyek|deadline/.test(String(segmentText || '').toLowerCase())) return 'aktivitas';
  return 'umum';
}

function deriveFallbackKey(memoryType = 'fakta', semanticCategory = 'umum', relation = null) {
  return normalizeMemoryKey([relation || semanticCategory || memoryType, memoryType].filter(Boolean).join('_')) || 'memori_subjek';
}

function buildSubjectAwareMemoryKey(baseKey = '', subjectInfo = {}, memoryType = 'fakta', options = {}) {
  const normalizedBase = normalizeMemoryKey(baseKey || deriveFallbackKey(memoryType, 'umum', subjectInfo?.relation));
  const subjectSlug = toSlug(subjectInfo?.subject || '');
  const currentSubjectSlug = toSlug(options.currentPersonName || '');

  if (!subjectSlug || subjectInfo?.isCurrentUser || (currentSubjectSlug && currentSubjectSlug === subjectSlug)) {
    return normalizedBase || normalizeMemoryKey(memoryType || 'fakta');
  }

  if (normalizedBase.startsWith(`${subjectSlug}_`)) return normalizedBase;
  return normalizeMemoryKey(`${subjectSlug}_${normalizedBase || memoryType}`);
}

function stripSubjectPrefix(text = '', subjectInfo = {}) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';

  let cleaned = raw.replace(TOPIC_SHIFT_REGEX, '').trim();
  const subject = String(subjectInfo?.subject || '').trim();
  const referencePrefixes = uniqueList((Array.isArray(subjectInfo?.referencePrefixes) ? subjectInfo.referencePrefixes : [])
    .map(prefix => String(prefix || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean))
    .sort((left, right) => right.length - left.length);

  if (subjectInfo?.isCurrentUser) {
    cleaned = cleaned.replace(/^(?:aku|saya|gue|gw|gua)\b[:,-]?\s*/i, '').trim();
  }

  for (const prefix of referencePrefixes) {
    cleaned = cleaned.replace(new RegExp(`^${escapeRegex(prefix)}\\b[:,-]?\\s*`, 'i'), '').trim();
  }

  if (subject) {
    const escapedSubject = escapeRegex(subject);
    const prefixPatterns = [
      new RegExp(`^(?:teman(?:ku|\\s+saya|\\s+kami)?|sahabat(?:ku|\\s+saya)?|istri(?:ku)?|suami(?:ku)?|anak(?:ku)?|(?:ayah|abi|bapak|papa)(?:ku)?|(?:ibu|ummi|mama|bunda)(?:ku)?|kakak(?:ku)?|adik(?:ku)?)\\s+${escapedSubject}\\b[:,-]?\\s*`, 'i'),
      new RegExp(`^${escapedSubject}\\b[:,-]?\\s*`, 'i')
    ];

    for (const pattern of prefixPatterns) {
      cleaned = cleaned.replace(pattern, '').trim();
    }
  }

  if (/^lagi\b/i.test(cleaned)) {
    cleaned = cleaned.replace(/^lagi\b/i, 'sedang').trim();
  }

  return compactText(cleaned || raw, 220);
}

function scoreStructuredCandidate(candidate = {}, userMessage = '', options = {}) {
  const intentAnalysis = analyzeMemoryIntent(userMessage, options);
  const normalizedType = normalizeMemoryType(candidate.memoryType || candidate.memory_type || 'fakta');
  const normalizedMessage = normalizeMemoryText(userMessage);
  const metadata = extractStructuredMemoryMetadata(candidate);

  let score = intentAnalysis.preferredTypes.includes(normalizedType) ? 0.28 : 0.12;
  if (metadata.subject && normalizedMessage.includes(normalizeMemoryText(metadata.subject))) score += 0.28;
  if (metadata.relation && normalizedMessage.includes(normalizeMemoryText(metadata.relation))) score += 0.12;
  if (metadata.semantic_category && normalizedMessage.includes(normalizeMemoryText(metadata.semantic_category))) score += 0.1;
  if (metadata.source_context === 'user_direct') score += 0.16;
  if (metadata.source_context === 'friend_via_account') score += 0.1;
  score += Math.min(0.16, String(metadata.value || '').length / 360);

  return Number(score.toFixed(4));
}

function matchSegmentCandidates(rawCandidate = {}, segments = []) {
  if (!Array.isArray(segments) || segments.length === 0) return [];

  const rawText = [rawCandidate.key, rawCandidate.value, rawCandidate.category]
    .map(part => String(part || ''))
    .join(' ')
    .trim();

  return segments
    .map(segment => ({
      segment,
      score: Math.max(
        jaccardSimilarity(rawText, segment.raw_text || ''),
        jaccardSimilarity(rawCandidate.value || '', segment.value || ''),
        jaccardSimilarity(rawCandidate.category || '', segment.semantic_category || '')
      )
    }))
    .sort((left, right) => right.score - left.score)
    .filter(item => item.score >= 0.06)
    .slice(0, String(rawCandidate.value || '').length > 140 ? 2 : 1)
    .map(item => item.segment);
}

function buildStructuredCandidateFromRaw(rawCandidate = {}, segment = null, options = {}) {
  const subjectInfo = segment?._subject_resolution || resolveSubject(
    options.userMessage || rawCandidate.value || '',
    options.knownFriends || [],
    options
  );

  if (!subjectInfo?.subject) {
    return { ok: false, reason: 'missing_subject' };
  }

  const memoryType = normalizeMemoryType(rawCandidate.memoryType || segment?.memoryType || 'fakta');
  const intentAnalysis = analyzeMemoryIntent(segment?.raw_text || options.userMessage || rawCandidate.value || '', options);
  const semanticCategory = resolveSemanticCategory(segment?.raw_text || rawCandidate.value || '', intentAnalysis, rawCandidate);
  const category = isLegacyCategory(rawCandidate.category || semanticCategory)
    ? LEGACY_MEMORY_CATEGORY
    : STRUCTURED_MEMORY_CATEGORY;

  let narrative = String(rawCandidate.value || '').trim();
  const derivedNarrative = stripSubjectPrefix(segment?.raw_text || narrative, subjectInfo);
  if (
    (Array.isArray(subjectInfo?.referencePrefixes) && subjectInfo.referencePrefixes.length > 0 && derivedNarrative)
    || !narrative
    || narrative.length > 220
    || jaccardSimilarity(narrative, derivedNarrative) < 0.22
  ) {
    narrative = derivedNarrative || narrative;
  }
  narrative = compactText(narrative, 220);

  const payload = {
    subject: subjectInfo.subject,
    relation: subjectInfo.relation,
    value: narrative,
    source_context: subjectInfo.source_context,
    face_id_hint: null,
    cctv_ready: false,
    semantic_category: semanticCategory
  };

  const key = buildSubjectAwareMemoryKey(rawCandidate.key, subjectInfo, memoryType, options);
  const structuredValue = stringifyStructuredMemoryValue(payload, narrative);
  const verdict = evaluateMemoryCandidate({
    key,
    value: structuredValue,
    memoryType,
    category,
    _skipStructuredValidation: true
  });

  if (!verdict.ok) {
    return { ok: false, reason: verdict.reason };
  }

  return {
    ok: true,
    memory: {
      ...verdict.memory,
      key,
      value: structuredValue,
      category,
      subject: payload.subject,
      relation: payload.relation,
      source_context: payload.source_context,
      face_id_hint: null,
      cctv_ready: false,
      semantic_category: semanticCategory,
      scope: resolveMemoryScope({ key, memoryType, category: semanticCategory }),
      _subject_resolution: subjectInfo
    }
  };
}

export function resolveSubject(text = '', knownFriends = [], options = {}) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  if (!raw) return null;

  const currentPersonName = titleCaseName(options.currentPersonName || '');
  const normalizedRaw = normalizeMemoryText(raw);
  const knownEntries = [
    ...buildKnownEntityEntries(knownFriends, 'teman'),
    ...buildKnownEntityEntries(options.familyMembers || [], null),
    ...buildKnownEntityEntries((options.familyNames || []).map(name => ({ name })), null)
  ];

  const candidates = [];
  const nestedRelationCandidate = buildNestedRelationCandidate(raw, knownEntries, {
    currentPersonName,
    familyMembers: options.familyMembers || []
  });
  const nestedRelationAliasSkips = new Set((nestedRelationCandidate?.headAliases || [])
    .map(alias => normalizeMemoryText(alias))
    .filter(Boolean));

  if (nestedRelationCandidate) {
    candidates.push(nestedRelationCandidate);
  }

  for (const definition of RELATION_PATTERN_DEFINITIONS) {
    definition.regex.lastIndex = 0;
    let match;
    while ((match = definition.regex.exec(raw)) !== null) {
      const extractedSubject = extractRelationTargetSubject(match[1] || '', knownEntries);
      if (!extractedSubject?.subject) continue;
      const subject = extractedSubject.subject;
      const normalized = extractedSubject.normalized;
      const knownEntry = extractedSubject.knownEntry || knownEntries.find(entry => entry.normalized === normalized);
      candidates.push({
        subject: knownEntry?.name || subject,
        normalized,
        relation: definition.relation,
        known: Boolean(knownEntry),
        explicit: true,
        isCurrentUser: currentPersonName && normalizeMemoryText(currentPersonName) === normalized
      });
    }
  }

  for (const entry of knownEntries) {
    if (!entry.normalized) continue;
    const matchedAlias = uniqueList([entry.normalized, ...(entry.aliases || [])])
      .find(alias => matchesTextAlias(normalizedRaw, alias));
    if (matchedAlias && nestedRelationAliasSkips.has(normalizeMemoryText(matchedAlias))) {
      continue;
    }
    if (matchedAlias && isNestedRelationAliasUsage(normalizedRaw, matchedAlias)) {
      continue;
    }
    if (matchedAlias) {
      candidates.push({
        subject: entry.name,
        normalized: entry.normalized,
        relation: entry.relation || detectRelationForSubject(raw, entry.name),
        known: true,
        explicit: matchedAlias !== entry.normalized,
        isCurrentUser: currentPersonName && normalizeMemoryText(currentPersonName) === entry.normalized
      });
    }
  }

  const leadingSubject = detectLeadingSubject(raw);
  if (leadingSubject) {
    const normalized = normalizeMemoryText(leadingSubject);
    const knownEntry = knownEntries.find(entry => entry.normalized === normalized);
    candidates.push({
      subject: knownEntry?.name || leadingSubject,
      normalized,
      relation: knownEntry?.relation || detectRelationForSubject(raw, leadingSubject),
      known: Boolean(knownEntry),
      explicit: false,
      isCurrentUser: currentPersonName && normalizeMemoryText(currentPersonName) === normalized
    });
  }

  if (currentPersonName && FIRST_PERSON_REGEX.test(raw)) {
    const normalized = normalizeMemoryText(currentPersonName);
    candidates.push({
      subject: currentPersonName,
      normalized,
      relation: 'diri',
      known: true,
      explicit: true,
      isCurrentUser: true
    });
  }

  const grouped = new Map();
  for (const candidate of candidates) {
    if (!candidate.subject || !candidate.normalized) continue;
    const score =
      (candidate.explicit ? 3 : 0)
      + (candidate.known ? 2 : 0)
      + (candidate.derivedFromKnownSubject ? 2 : 0)
      + (candidate.relation ? 1 : 0)
      + (candidate.isCurrentUser ? 2 : 0)
      + (candidate.nestedRelation ? 4 : 0)
      + (candidate.canonicalTarget ? 2 : 0);
    const existing = grouped.get(candidate.normalized);
    if (!existing || score > existing.score) {
      grouped.set(candidate.normalized, { ...candidate, score });
    }
  }

  const ranked = [...grouped.values()].sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    if (right.subject.length !== left.subject.length) return right.subject.length - left.subject.length;
    return left.subject.localeCompare(right.subject);
  });

  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0].score === ranked[1].score && ranked[0].normalized !== ranked[1].normalized) {
    return null;
  }

  const selected = ranked[0];
  return {
    subject: selected.subject,
    relation: normalizeRelation(selected.relation || (selected.isCurrentUser ? 'diri' : '')),
    source_context: normalizeSourceContext(selected.source_context || (
      selected.isCurrentUser
        ? 'user_direct'
        : (selected.explicit || selected.known ? 'friend_via_account' : 'ai_inference')
    )),
    isCurrentUser: selected.isCurrentUser,
    isKnownFriend: selected.known,
    needsProvisionalFriend: !selected.isCurrentUser && !selected.known && ['teman', 'sahabat'].includes(normalizeRelation(selected.relation || '')),
    normalizedSubject: selected.normalized,
    isDerivedSubject: Boolean(selected.nestedRelation),
    derivedFromKnownSubject: Boolean(selected.derivedFromKnownSubject),
    derivedFromSubject: selected.parentSubject || null,
    derivedFromRelation: normalizeRelation(selected.parentRelation || ''),
    referencePrefixes: uniqueList(selected.referencePrefixes || [])
  };
}

export function parseLongMessageToCandidates(text = '', options = {}) {
  const raw = String(text || '').replace(/\r/g, '\n').trim();
  if (!raw) return [];

  const pieces = raw
    .split(/\n+|[.!?;]+/g)
    .map(piece => piece.trim())
    .filter(Boolean);

  const segments = [];
  let currentSegment = '';

  for (const piece of pieces) {
    const cleanedPiece = piece.replace(TOPIC_SHIFT_REGEX, '').trim();
    if (!cleanedPiece) continue;

    if (!currentSegment) {
      currentSegment = cleanedPiece;
      continue;
    }

    const currentSubject = resolveSubject(currentSegment, options.knownFriends || [], options);
    const nextSubject = resolveSubject(cleanedPiece, options.knownFriends || [], options);
    const currentIntent = analyzeMemoryIntent(currentSegment, options).intent;
    const nextIntent = analyzeMemoryIntent(cleanedPiece, options).intent;
    const shouldSplit = TOPIC_SHIFT_REGEX.test(piece)
      || (currentSubject?.subject && nextSubject?.subject && currentSubject.normalizedSubject !== nextSubject.normalizedSubject)
      || (currentIntent && nextIntent && currentIntent !== nextIntent && cleanedPiece.length > 28);

    if (shouldSplit) {
      segments.push(currentSegment);
      currentSegment = cleanedPiece;
      continue;
    }

    currentSegment = `${currentSegment}. ${cleanedPiece}`;
  }

  if (currentSegment) segments.push(currentSegment);

  const candidateSegments = [];
  for (const segmentText of segments.slice(0, MAX_MEMORY_CANDIDATES_PER_MESSAGE * 2)) {
    const subjectInfo = resolveSubject(segmentText, options.knownFriends || [], options);
    if (!subjectInfo?.subject) continue;

    const intentAnalysis = analyzeMemoryIntent(segmentText, options);
    const memoryType = normalizeMemoryType(options.memoryType || intentAnalysis.preferredTypes?.[0] || 'fakta');
    const semanticCategory = resolveSemanticCategory(segmentText, intentAnalysis, options);
    const key = buildSubjectAwareMemoryKey(
      options.key || deriveFallbackKey(memoryType, semanticCategory, subjectInfo.relation),
      subjectInfo,
      memoryType,
      options
    );
    const narrative = stripSubjectPrefix(segmentText, subjectInfo);
    if (!narrative || LOW_SIGNAL_VALUE_REGEX.test(narrative)) continue;

    candidateSegments.push({
      key,
      type: memoryType,
      memoryType,
      category: isLegacyCategory(semanticCategory) ? LEGACY_MEMORY_CATEGORY : STRUCTURED_MEMORY_CATEGORY,
      semantic_category: semanticCategory,
      scope: resolveMemoryScope({ key, memoryType, category: semanticCategory }),
      value: narrative,
      subject: subjectInfo.subject,
      relation: subjectInfo.relation,
      source_context: subjectInfo.source_context,
      face_id_hint: null,
      cctv_ready: false,
      raw_text: segmentText,
      _subject_resolution: subjectInfo
    });
  }

  return candidateSegments.slice(0, MAX_MEMORY_CANDIDATES_PER_MESSAGE);
}

export function evaluateMemoryCandidate(candidate = {}) {
  const normalizedKey = normalizeMemoryKey(candidate.key || '');
  const normalizedType = normalizeMemoryType(candidate.memoryType || 'fakta');
  const structuredPayload = parseStructuredMemoryValue(candidate.value || '');
  const value = structuredPayload?.value || String(candidate.value || '').trim();
  const category = String(candidate.category || 'umum').trim().toLowerCase().slice(0, 60) || 'umum';
  const skipStructuredValidation = Boolean(candidate._skipStructuredValidation);

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

  if (!skipStructuredValidation && value.length > 220) {
    return { ok: false, reason: 'value_too_long' };
  }

  const keyAsText = normalizeMemoryText(normalizedKey.replace(/_/g, ' '));
  const valueAsText = normalizeMemoryText(value);
  if (!skipStructuredValidation && !isIdentityKey && keyAsText && valueAsText && (valueAsText === keyAsText || valueAsText.startsWith(`${keyAsText} `))) {
    return { ok: false, reason: 'value_redundant_with_key' };
  }

  if (skipStructuredValidation && structuredPayload && !structuredPayload.subject) {
    return { ok: false, reason: 'missing_subject' };
  }

  return {
    ok: true,
    memory: {
      key: normalizedKey,
      value: String(candidate.value || '').trim() || value,
      memoryType: normalizedType,
      category
    }
  };
}

export function filterMemoryUpserts(memoryUpserts = [], options = {}) {
  const maxItems = Math.max(1, Math.min(MAX_MEMORY_CANDIDATES_PER_MESSAGE, Number(options.maxItems || MAX_MEMORY_CANDIDATES_PER_MESSAGE)));
  const accepted = [];
  const rejected = [];
  const expanded = [];
  const sourceSegments = parseLongMessageToCandidates(options.userMessage || '', options);

  for (const rawCandidate of Array.isArray(memoryUpserts) ? memoryUpserts : []) {
    const verdict = evaluateMemoryCandidate(rawCandidate);
    if (!verdict.ok && verdict.reason !== 'value_too_long') {
      rejected.push({
        key: normalizeMemoryKey(rawCandidate?.key || ''),
        reason: verdict.reason
      });
      continue;
    }

    const matchedSegments = matchSegmentCandidates(rawCandidate, sourceSegments);
    const fallbackSegments = matchedSegments.length > 0
      ? matchedSegments
      : parseLongMessageToCandidates(rawCandidate.value || '', {
          ...options,
          key: rawCandidate.key,
          category: rawCandidate.category,
          memoryType: rawCandidate.memoryType
        });

    const segmentsToProcess = fallbackSegments.length > 0 ? fallbackSegments : [null];
    let generatedCount = 0;

    for (const segment of segmentsToProcess) {
      const structuredCandidate = buildStructuredCandidateFromRaw(rawCandidate, segment, options);
      if (!structuredCandidate.ok) {
        rejected.push({
          key: normalizeMemoryKey(rawCandidate?.key || ''),
          reason: structuredCandidate.reason
        });
        continue;
      }

      expanded.push({
        ...structuredCandidate.memory,
        _candidate_score: scoreStructuredCandidate(structuredCandidate.memory, options.userMessage || '', options)
      });
      generatedCount += 1;
    }

    if (generatedCount === 0 && verdict.reason === 'value_too_long') {
      rejected.push({
        key: normalizeMemoryKey(rawCandidate?.key || ''),
        reason: 'value_too_long'
      });
    }
  }

  expanded.sort((left, right) => {
    if (right._candidate_score !== left._candidate_score) {
      return right._candidate_score - left._candidate_score;
    }
    return String(left.key || '').localeCompare(String(right.key || ''));
  });

  const seenClaims = new Set();
  for (const candidate of expanded) {
    const claimHash = buildMemoryClaimHash(candidate);
    if (seenClaims.has(claimHash)) {
      rejected.push({ key: candidate.key, reason: 'duplicate_in_reply' });
      continue;
    }

    if (accepted.length >= maxItems) {
      rejected.push({ key: candidate.key, reason: 'over_limit' });
      continue;
    }

    seenClaims.add(claimHash);
    accepted.push(candidate);
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
  const metadata = extractStructuredMemoryMetadata(memory);
  const fallback = humanizeMemoryLabel(memory.key || 'memori tanpa detail');

  if (String(memory.category || '').trim().toLowerCase() === PROVISIONAL_FRIEND_CATEGORY) {
    const label = metadata.subject || fallback;
    const mentionCount = metadata.mention_count || Number(memory.observation_count || 1);
    const placeholderValue = metadata.value || 'menunggu konfirmasi hubungan';
    return `- ${label} [provisional ${mentionCount}x]: ${placeholderValue}`;
  }

  if (metadata.subject) {
    const relationLabel = metadata.relation && metadata.relation !== 'diri'
      ? ` (${metadata.relation})`
      : '';
    const semanticLabel = metadata.semantic_category && metadata.semantic_category !== 'umum'
      ? ` {${metadata.semantic_category}}`
      : '';
    return `- ${metadata.subject}${relationLabel}: ${metadata.value || fallback}${semanticLabel}`;
  }

  const value = String(metadata.value || memory.value || '').trim();
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

  const stableAndLegacy = memories.filter(memory => isLegacyMemory(memory) || String(memory.memory_scope || '').trim().toLowerCase() === 'stable');
  const provisionalFriends = memories.filter(memory => String(memory.category || '').trim().toLowerCase() === PROVISIONAL_FRIEND_CATEGORY);
  const dynamicMemories = memories.filter(memory => !stableAndLegacy.includes(memory) && !provisionalFriends.includes(memory));

  const sections = [
    { title: 'WARISAN & TRAIT INTI', rows: stableAndLegacy },
    { title: 'POLA PERILAKU', types: ['pattern', 'kebiasaan'] },
    { title: 'CARA BERPIKIR', types: ['cara_berpikir'] },
    { title: 'PREFERENSI', types: ['preferensi'] },
    { title: 'EMOSI', types: ['emosi'] },
    { title: 'FAKTA KUNCI', types: ['fakta'] },
    { title: 'CALON TEMAN', rows: provisionalFriends }
  ];

  const blocks = [];
  for (const section of sections) {
    const sourceRows = Array.isArray(section.rows)
      ? section.rows
      : dynamicMemories.filter(memory => section.types.includes(normalizeMemoryType(memory.memory_type || 'fakta')));
    const rows = uniqueList(sourceRows.map(buildMemoryBullet));

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
  const metadata = extractStructuredMemoryMetadata(memory);
  const query = normalizeMemoryText(message);
  const memoryText = [
    memory.key,
    metadata.subject,
    metadata.relation,
    metadata.value,
    metadata.semantic_category,
    normalizedType
  ]
    .map(part => normalizeMemoryText(part || ''))
    .join(' ')
    .trim();

  if (!query || !memoryText) {
    return preferredTypes.includes(normalizedType) ? 0.45 : 0.2;
  }

  const lexical = jaccardSimilarity(query, memoryText);
  const typeBoost = preferredTypes.includes(normalizedType) ? 0.35 : 0.08;
  const categoryBoost = metadata.semantic_category && query.includes(normalizeMemoryText(metadata.semantic_category)) ? 0.15 : 0;
  const relationTerms = [
    ...(contextSignals.relationSignals?.signals || []),
    ...(contextSignals.relationSignals?.mentionedNames || [])
  ].map(normalizeMemoryText);
  const relationBoost = relationTerms.some(term => term && memoryText.includes(term))
    ? 0.18
    : (contextSignals.subjectInfo?.relation
      && metadata.relation
      && normalizeMemoryText(metadata.relation) === normalizeMemoryText(contextSignals.subjectInfo.relation)
        ? 0.12
        : 0);
  const subjectBoost = contextSignals.subjectInfo?.subject
    && metadata.subject
    && normalizeMemoryText(metadata.subject) === normalizeMemoryText(contextSignals.subjectInfo.subject)
      ? 0.24
      : 0;
  const timeBoost = contextSignals.timingIntent === 'di_luar_rutinitas' && ['pattern', 'kebiasaan', 'emosi'].includes(normalizedType)
    ? 0.12
    : 0;
  const emotionalBoost = ['butuh_validasi', 'perlu_stabilisasi'].includes(contextSignals.emotionalIntent)
    && ['emosi', 'pattern', 'cara_berpikir'].includes(normalizedType)
      ? 0.15
      : 0;
  const recurrentTopics = normalizeTextList(contextSignals.recurrentTopics || []);
  const topicalBoost = recurrentTopics.some(topic => topic && memoryText.includes(topic)) ? 0.12 : 0;

  return Number(Math.min(1, lexical + typeBoost + categoryBoost + relationBoost + subjectBoost + timeBoost + emotionalBoost + topicalBoost).toFixed(4));
}

function dedupeMemoryRows(memories = []) {
  const rows = [];
  const seen = new Set();

  for (const memory of Array.isArray(memories) ? memories : []) {
    if (!memory) continue;
    const dedupeKey = memory.id || buildMemoryClaimHash(memory);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    rows.push(memory);
  }

  return rows;
}

function buildEmptySelection(userMessage = '', options = {}, extra = {}) {
  const emptyAnalysis = analyzeMemoryIntent(userMessage, options);
  return {
    items: [],
    legacyItems: [],
    dynamicItems: [],
    provisionalItems: [],
    checkpointSummary: '',
    contextBlock: '',
    allMemories: [],
    subjectInfo: resolveSubject(userMessage, options.knownFriends || [], options),
    intent: emptyAnalysis.intent,
    intents: emptyAnalysis.intents,
    preferredTypes: emptyAnalysis.preferredTypes,
    emotionalIntent: emptyAnalysis.emotionalIntent,
    timingIntent: emptyAnalysis.timingIntent,
    relationSignals: emptyAnalysis.relationSignals,
    reasoning: emptyAnalysis.reasoning,
    ...extra
  };
}

function sortStableMemories(memories = []) {
  return [...(Array.isArray(memories) ? memories : [])].sort((left, right) => {
    const leftLegacy = isLegacyMemory(left) ? 1 : 0;
    const rightLegacy = isLegacyMemory(right) ? 1 : 0;
    if (rightLegacy !== leftLegacy) return rightLegacy - leftLegacy;
    if ((right.priority_score || 0) !== (left.priority_score || 0)) return (right.priority_score || 0) - (left.priority_score || 0);
    return new Date(right.updated_at || 0).getTime() - new Date(left.updated_at || 0).getTime();
  });
}

function buildSelectionContextBlock({ checkpointSummary = '', legacyItems = [], dynamicItems = [], provisionalItems = [] } = {}) {
  const blocks = [];
  const parsedCheckpoint = safeParseCheckpointSummary(checkpointSummary);
  if (parsedCheckpoint.summary) {
    blocks.push(`[CHECKPOINT SESI]\n${parsedCheckpoint.summary}`);
  }

  const merged = [...legacyItems, ...dynamicItems, ...provisionalItems];
  if (merged.length > 0) {
    blocks.push(buildMemoryContext(merged));
  }

  return blocks.join('\n\n').trim();
}

function buildHybridSelectionFromRows(memories = [], userMessage = '', options = {}) {
  const rows = dedupeMemoryRows(memories);
  if (rows.length === 0) {
    return buildEmptySelection(userMessage, options);
  }

  const intentAnalysis = analyzeMemoryIntent(userMessage, options);
  const subjectInfo = resolveSubject(userMessage, options.knownFriends || [], options);
  const weights = options.weights || { priority: 0.55, relevance: 0.35, freshness: 0.10 };
  const dynamicLimit = Math.max(3, Math.min(5, Number(options.dynamicLimit || 5)));

  const legacyItems = sortStableMemories(rows.filter(memory => isLegacyMemory(memory) || String(memory.memory_scope || '').trim().toLowerCase() === 'stable'));
  const provisionalItems = rows
    .filter(memory => String(memory.category || '').trim().toLowerCase() === PROVISIONAL_FRIEND_CATEGORY)
    .filter(memory => computeRelevanceToQuery(memory, userMessage, intentAnalysis.preferredTypes, {
      emotionalIntent: intentAnalysis.emotionalIntent,
      timingIntent: intentAnalysis.timingIntent,
      relationSignals: intentAnalysis.relationSignals,
      recurrentTopics: options.recurrentTopics || [],
      subjectInfo
    }) >= 0.38)
    .slice(0, 1);

  const dynamicPool = rows.filter(memory => {
    if (legacyItems.some(item => (item.id && memory.id ? item.id === memory.id : item.key === memory.key))) return false;
    return String(memory.category || '').trim().toLowerCase() !== PROVISIONAL_FRIEND_CATEGORY;
  });

  const scoredDynamic = dynamicPool.map(memory => {
    const basePriority = Number(memory.priority_score || computePriorityScore(memory.confidence || 0.7, memory.observation_count || 1));
    const relevance = computeRelevanceToQuery(memory, userMessage, intentAnalysis.preferredTypes, {
      emotionalIntent: intentAnalysis.emotionalIntent,
      timingIntent: intentAnalysis.timingIntent,
      relationSignals: intentAnalysis.relationSignals,
      recurrentTopics: options.recurrentTopics || [],
      subjectInfo
    });
    const freshness = computeFreshnessScore(memory.updated_at);
    const finalScore = Number((
      weights.priority * basePriority +
      weights.relevance * relevance +
      weights.freshness * freshness
    ).toFixed(4));

    return {
      ...memory,
      _intent: intentAnalysis.intent,
      _relevance: relevance,
      _freshness: freshness,
      _final_score: finalScore
    };
  });

  scoredDynamic.sort((left, right) => {
    if (right._final_score !== left._final_score) return right._final_score - left._final_score;
    if ((right.priority_score || 0) !== (left.priority_score || 0)) return (right.priority_score || 0) - (left.priority_score || 0);
    return new Date(right.updated_at || 0).getTime() - new Date(left.updated_at || 0).getTime();
  });

  const dynamicItems = scoredDynamic.slice(0, dynamicLimit);
  const items = dedupeMemoryRows([...legacyItems, ...dynamicItems, ...provisionalItems]);
  const checkpointSummary = String(options.checkpointSummary || '').trim();

  return {
    items,
    legacyItems,
    dynamicItems,
    provisionalItems,
    checkpointSummary,
    contextBlock: buildSelectionContextBlock({ checkpointSummary, legacyItems, dynamicItems, provisionalItems }),
    allMemories: rows,
    subjectInfo,
    intent: intentAnalysis.intent,
    intents: intentAnalysis.intents,
    preferredTypes: intentAnalysis.preferredTypes,
    emotionalIntent: intentAnalysis.emotionalIntent,
    timingIntent: intentAnalysis.timingIntent,
    relationSignals: intentAnalysis.relationSignals,
    reasoning: intentAnalysis.reasoning
  };
}

async function loadMemorySelectionSources({ supabase, personId, sessionId = null, legacyLimit = DEFAULT_LEGACY_POOL_LIMIT, dynamicPoolLimit = DEFAULT_DYNAMIC_POOL_LIMIT } = {}) {
  const fields = 'id, key, value, confidence, observation_count, updated_at, priority_score, memory_type, category, status, memory_scope, source_message_id, source_person_id';
  const accessCutoffIso = new Date(Date.now() - LEGACY_ACCESS_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [stableResult, warisanResult, dynamicResult, sessionResult, legacyAccessResult] = await Promise.all([
    supabase
      .from('person_memory')
      .select(fields)
      .eq('person_id', personId)
      .eq('status', 'active')
      .eq('memory_scope', 'stable')
      .neq('category', LEGACY_MEMORY_CATEGORY)
      .order('priority_score', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(Math.max(24, Number(legacyLimit || DEFAULT_LEGACY_POOL_LIMIT))),
    supabase
      .from('person_memory')
      .select(fields)
      .eq('person_id', personId)
      .eq('status', 'active')
      .eq('category', LEGACY_MEMORY_CATEGORY)
      .order('priority_score', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(Math.max(MAX_WARISAN_RETRIEVAL_ROWS, Number(legacyLimit || DEFAULT_LEGACY_POOL_LIMIT))),
    supabase
      .from('person_memory')
      .select(fields)
      .eq('person_id', personId)
      .eq('status', 'active')
      .eq('memory_scope', 'dynamic')
      .order('updated_at', { ascending: false })
      .limit(Math.max(18, Number(dynamicPoolLimit || DEFAULT_DYNAMIC_POOL_LIMIT))),
    sessionId
      ? supabase
          .from('sessions')
          .select('compact_checkpoint_summary')
          .eq('id', sessionId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from('legacy_audit_log')
      .select('memory_id, created_at')
      .eq('person_id', personId)
      .eq('event_type', 'memory_accessed')
      .gte('created_at', accessCutoffIso)
      .order('created_at', { ascending: false })
      .limit(200)
  ]);

  if (stableResult.error) throw stableResult.error;
  if (warisanResult.error) throw warisanResult.error;
  if (dynamicResult.error) throw dynamicResult.error;
  if (sessionResult?.error) throw sessionResult.error;
  if (legacyAccessResult.error) throw legacyAccessResult.error;

  const recentLegacyAccess = new Map();
  for (const entry of legacyAccessResult.data || []) {
    if (!entry?.memory_id || recentLegacyAccess.has(entry.memory_id)) continue;
    recentLegacyAccess.set(entry.memory_id, entry.created_at);
  }

  const recentWarisanItems = (warisanResult.data || [])
    .filter(Boolean)
    .filter((memory) => {
      const effectiveLastAccessed = recentLegacyAccess.get(memory.id) || memory.updated_at || null;
      const lastTouchedMs = new Date(effectiveLastAccessed || 0).getTime();
      return Number.isFinite(lastTouchedMs) && lastTouchedMs >= new Date(accessCutoffIso).getTime();
    })
    .slice(0, MAX_WARISAN_RETRIEVAL_ROWS);

  const checkpointState = safeParseCheckpointSummary(sessionResult?.data?.compact_checkpoint_summary || '');

  return {
    legacyItems: dedupeMemoryRows([...(stableResult.data || []).filter(Boolean), ...recentWarisanItems]),
    dynamicItems: dedupeMemoryRows((dynamicResult.data || []).filter(memory => !isLegacyMemory(memory))),
    checkpointSummary: checkpointState.summary,
    checkpointMetadata: checkpointState.metadata
  };
}

export async function selectRelevantMemories(memories = [], userMessage = '', options = {}) {
  if (options.supabase && options.personId) {
    const sourceBundle = await loadMemorySelectionSources({
      supabase: options.supabase,
      personId: options.personId,
      sessionId: options.sessionId || null,
      legacyLimit: options.legacyLimit,
      dynamicPoolLimit: options.dynamicPoolLimit
    });

    const combinedRows = dedupeMemoryRows([...sourceBundle.legacyItems, ...sourceBundle.dynamicItems]);
    return buildHybridSelectionFromRows(combinedRows, userMessage, {
      ...options,
      checkpointSummary: sourceBundle.checkpointSummary,
      checkpointMetadata: sourceBundle.checkpointMetadata
    });
  }

  if (!Array.isArray(memories) || memories.length === 0) {
    return buildEmptySelection(userMessage, options);
  }

  return buildHybridSelectionFromRows(memories, userMessage, options);
}

export async function recordLegacyMemoryAccesses(supabase, personId, items = [], options = {}) {
  if (!supabase || !personId) return { touched: 0 };

  const legacyRows = (Array.isArray(items) ? items : [])
    .filter(memory => memory?.id && isLegacyMemory(memory));
  if (!legacyRows.length) return { touched: 0 };

  await writeLegacyAuditEntries(supabase, personId, legacyRows.map(memory => ({
    memory_id: memory.id,
    session_id: options.sessionId || null,
    source_message_id: options.sourceMessageId || null,
    event_type: 'memory_accessed',
    reason_code: options.reasonCode || 'legacy_prompt_retrieval',
    payload: {
      key: normalizeMemoryKey(memory.key || ''),
      intent: options.intent || null,
      category: memory.category || null
    }
  })));

  return { touched: legacyRows.length };
}

function buildLegacyAuditRows(personId, entries = []) {
  return (Array.isArray(entries) ? entries : [])
    .filter(Boolean)
    .map(entry => ({
      person_id: personId || entry.person_id || null,
      memory_id: entry.memory_id || null,
      evidence_id: entry.evidence_id || null,
      session_id: entry.session_id || null,
      source_message_id: entry.source_message_id || null,
      event_type: entry.event_type,
      reason_code: entry.reason_code || null,
      payload: entry.payload && typeof entry.payload === 'object' ? entry.payload : {}
    }));
}

async function writeLegacyAuditEntries(supabase, personId, entries = []) {
  const rows = buildLegacyAuditRows(personId, entries);
  if (!rows.length) return;

  const { error } = await supabase.from('legacy_audit_log').insert(rows);
  if (error) throw error;
}

export function shouldSkipAutomatedMutation(memory = {}, options = {}) {
  const lockedKeys = options.lockedKeys instanceof Set
    ? options.lockedKeys
    : new Set((Array.isArray(options.lockedKeys) ? options.lockedKeys : []).map(item => normalizeMemoryKey(item)));

  if (Boolean(memory.is_locked)) return true;
  if (isLegacyMemory(memory)) return true;
  if (String(memory.category || '').trim().toLowerCase() === PROVISIONAL_FRIEND_CATEGORY) return true;
  return lockedKeys.has(normalizeMemoryKey(memory.key || memory.memory_key || ''));
}

export async function applyMemoryDecayAndBudget(supabase, personId, options = {}) {
  if (!supabase || !personId) {
    return { decayed: 0, archived: 0 };
  }

  const lifecycleKey = `${personId}:${options.userId || '-'}`;
  if (lifecycleRuns.has(lifecycleKey)) {
    return lifecycleRuns.get(lifecycleKey);
  }

  const runPromise = (async () => {
    const lockedKeys = options.lockedKeys instanceof Set
      ? options.lockedKeys
      : await getLockedMemoryKeys({ supabase, userId: options.userId || null });
    const nowIso = new Date().toISOString();
    const decayCutoffMs = Date.now() - DECAY_AFTER_DAYS * 24 * 60 * 60 * 1000;
    const fields = 'id, key, value, confidence, observation_count, updated_at, priority_score, memory_type, category, status, memory_scope';
    const { data, error } = await supabase
      .from('person_memory')
      .select(fields)
      .eq('person_id', personId)
      .eq('status', 'active')
      .order('priority_score', { ascending: false })
      .order('updated_at', { ascending: false });

    if (error) throw error;

    const activeRows = Array.isArray(data) ? data : [];
    const auditEntries = [];
    let decayed = 0;
    let archived = 0;

    for (const row of activeRows) {
      const valueState = safeParseValue(row);
      if (shouldSkipAutomatedMutation(row, { lockedKeys })) continue;
      if (String(row.memory_scope || '').trim().toLowerCase() !== 'dynamic') continue;
      if (String(row.category || '').trim().toLowerCase() === PROVISIONAL_FRIEND_CATEGORY || valueState.status === 'pending') continue;

      const updatedTime = new Date(row.updated_at || 0).getTime();
      if (!Number.isFinite(updatedTime) || updatedTime > decayCutoffMs) continue;

      const nextConfidence = Number(clampNumber(Number(row.confidence || 0.68) * 0.92, 0.2, 0.96).toFixed(4));
      const nextPriority = Number(clampNumber(Number(row.priority_score || computePriorityScore(nextConfidence, row.observation_count || 1)) * 0.9, 0.02, 1).toFixed(4));

      if (nextConfidence === Number(row.confidence || 0) && nextPriority === Number(row.priority_score || 0)) {
        continue;
      }

      const { error: decayError } = await supabase
        .from('person_memory')
        .update({
          confidence: nextConfidence,
          priority_score: nextPriority
        })
        .eq('id', row.id)
        .eq('status', 'active');

      if (decayError) throw decayError;

      row.confidence = nextConfidence;
      row.priority_score = nextPriority;
      decayed += 1;
      auditEntries.push({
        memory_id: row.id,
        event_type: 'memory_decay_applied',
        reason_code: 'dynamic_decay_over_14_days',
        payload: {
          timestamp: nowIso,
          old_value: {
            confidence: Number(row.confidence || 0),
            priority_score: Number(row.priority_score || 0),
            status: 'active',
            fallback_legacy: valueState.fallback_legacy,
            corrupted_json: valueState.corrupted_json
          },
          new_value: {
            confidence: nextConfidence,
            priority_score: nextPriority,
            status: 'active'
          }
        }
      });
    }

    const activeBudgetRows = activeRows.filter(row => {
      const valueState = safeParseValue(row);
      return String(row.category || '').trim().toLowerCase() !== PROVISIONAL_FRIEND_CATEGORY && valueState.status !== 'pending';
    });
    const overflow = Math.max(0, activeBudgetRows.length - ACTIVE_MEMORY_BUDGET);
    if (overflow > 0) {
      const eligibleRows = activeBudgetRows
        .filter(row => !shouldSkipAutomatedMutation(row, { lockedKeys }))
        .sort((left, right) => {
          if ((left.priority_score || 0) !== (right.priority_score || 0)) {
            return (left.priority_score || 0) - (right.priority_score || 0);
          }
          return new Date(left.updated_at || 0).getTime() - new Date(right.updated_at || 0).getTime();
        })
        .slice(0, overflow);

      for (const row of eligibleRows) {
        const { error: archiveError } = await supabase
          .from('person_memory')
          .update({
            status: 'archived',
            deleted_at: nowIso,
            deletion_reason: 'budget_archive'
          })
          .eq('id', row.id)
          .eq('status', 'active');

        if (archiveError) throw archiveError;

        archived += 1;
        auditEntries.push({
          memory_id: row.id,
          event_type: 'memory_archived',
          reason_code: 'budget_archive',
          payload: {
            timestamp: nowIso,
            old_value: {
              status: 'active',
              category: row.category || null,
              memory_scope: row.memory_scope || null,
              priority_score: Number(row.priority_score || 0)
            },
            new_value: {
              status: 'archived',
              category: row.category || null,
              memory_scope: row.memory_scope || null,
              priority_score: Number(row.priority_score || 0)
            }
          }
        });
      }
    }

    if (auditEntries.length > 0) {
      await writeLegacyAuditEntries(supabase, personId, auditEntries);
    }

    return { decayed, archived };
  })().finally(() => {
    lifecycleRuns.delete(lifecycleKey);
  });

  lifecycleRuns.set(lifecycleKey, runPromise);
  return runPromise;
}

export async function trackProvisionalFriend(supabase, personId, text = '', options = {}) {
  const subjectInfo = resolveSubject(text, options.knownFriends || [], options);
  if (!subjectInfo?.subject || !subjectInfo.needsProvisionalFriend) {
    return { tracked: false, reason: subjectInfo?.subject ? 'already_known' : 'missing_subject' };
  }

  const key = `mention_${toSlug(subjectInfo.subject)}`;
  const nowIso = new Date().toISOString();
  const narrative = stripSubjectPrefix(text, subjectInfo) || compactText(text, 180);

  try {
    const { data: rpcResult, error: rpcError } = await supabase.rpc('upsert_provisional_friend_mention', {
      p_person_id: personId,
      p_key: key,
      p_subject: subjectInfo.subject,
      p_relation: subjectInfo.relation || 'teman',
      p_context: compactText(text, 180),
      p_value: narrative,
      p_source_context: subjectInfo.source_context,
      p_source_message_id: options.sourceMessageId || null,
      p_source_person_id: options.sourcePersonId || null
    });

    if (rpcError) throw rpcError;

    const row = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
    if (row?.id) {
      await writeLegacyAuditEntries(supabase, personId, [{
        memory_id: row.id,
        event_type: row.was_inserted ? 'provisional_friend_created' : 'provisional_friend_updated',
        reason_code: 'friend_mention_detected',
        payload: {
          timestamp: nowIso,
          old_value: row.was_inserted
            ? null
            : {
                mention_count: Number(row.previous_mention_count || Math.max(0, Number(row.current_mention_count || 1) - 1)),
                status: 'pending'
              },
          new_value: {
            mention_count: Number(row.current_mention_count || row.observation_count || 1),
            status: 'pending'
          }
        }
      }]);

      return {
        tracked: true,
        memory: row,
        mention_count: Number(row.current_mention_count || row.observation_count || 1),
        subject: subjectInfo.subject
      };
    }
  } catch (rpcErr) {
    const rpcMessage = String(rpcErr?.message || '').toLowerCase();
    if (!rpcMessage.includes('upsert_provisional_friend_mention') && rpcErr?.code !== '42883') {
      throw rpcErr;
    }
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { data: existing, error: existingError } = await supabase
      .from('person_memory')
      .select('id, key, value, observation_count, confidence, priority_score, status, category, memory_scope')
      .eq('person_id', personId)
      .eq('key', key)
      .maybeSingle();

    if (existingError) throw existingError;

    const existingMetadata = extractStructuredMemoryMetadata(existing || {});
    const mentionCount = Math.max(1, Number(existingMetadata.mention_count || existing?.observation_count || 0) + 1);
    const payload = stringifyStructuredMemoryValue({
      name: subjectInfo.subject,
      subject: subjectInfo.subject,
      relation: subjectInfo.relation || 'teman',
      context: compactText(text, 180),
      value: narrative,
      source_context: subjectInfo.source_context,
      face_id_hint: null,
      cctv_ready: false,
      mention_count: mentionCount,
      first_seen: existingMetadata.first_seen || nowIso,
      last_seen: nowIso,
      status: 'pending',
      semantic_category: 'relasi'
    }, narrative);

    const basePayload = {
      value: payload,
      memory_type: 'fakta',
      category: PROVISIONAL_FRIEND_CATEGORY,
      status: 'active',
      memory_scope: 'dynamic',
      confidence: Number(clampNumber(0.35 + (mentionCount - 1) * 0.08, 0.35, 0.72).toFixed(4)),
      observation_count: mentionCount,
      priority_score: Number(clampNumber(0.2 + mentionCount * 0.08, 0.2, 0.7).toFixed(4)),
      source_message_id: options.sourceMessageId || null,
      source_person_id: options.sourcePersonId || null
    };

    if (existing?.id) {
      const { data: updatedRow, error: updateError } = await supabase
        .from('person_memory')
        .update(basePayload)
        .eq('id', existing.id)
        .select('id, key, value, observation_count, category, status, memory_scope')
        .single();

      if (updateError) throw updateError;
      await writeLegacyAuditEntries(supabase, personId, [{
        memory_id: updatedRow?.id || existing.id,
        event_type: 'provisional_friend_updated',
        reason_code: 'friend_mention_detected',
        payload: {
          timestamp: nowIso,
          old_value: {
            mention_count: Number(existingMetadata.mention_count || existing.observation_count || 0),
            status: existingMetadata.status || 'pending'
          },
          new_value: {
            mention_count: mentionCount,
            status: 'pending'
          }
        }
      }]);
      return { tracked: true, memory: updatedRow, mention_count: mentionCount, subject: subjectInfo.subject };
    }

    const { data: insertedRow, error: insertError } = await supabase
      .from('person_memory')
      .insert({
        person_id: personId,
        key,
        ...basePayload
      })
      .select('id, key, value, observation_count, category, status, memory_scope')
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        continue;
      }
      throw insertError;
    }

    await writeLegacyAuditEntries(supabase, personId, [{
      memory_id: insertedRow?.id || null,
      event_type: 'provisional_friend_created',
      reason_code: 'friend_mention_detected',
      payload: {
        timestamp: nowIso,
        old_value: null,
        new_value: {
          mention_count: mentionCount,
          status: 'pending'
        }
      }
    }]);
    return { tracked: true, memory: insertedRow, mention_count: mentionCount, subject: subjectInfo.subject };
  }

  throw new Error('Gagal menyimpan provisional friend setelah retry.');
}

function buildRelationshipPairKey(personA = '', personB = '', relationType = '') {
  return `${personA || ''}:${personB || ''}:${relationType || ''}`;
}

function normalizeRelationshipStatus(status = '') {
  return String(status || '').trim().toLowerCase();
}

function summarizeRelationshipValidation(rows = [], relationshipRows = [], options = {}) {
  const expectedPairKeys = (Array.isArray(relationshipRows) ? relationshipRows : [])
    .map(row => buildRelationshipPairKey(row.person_a, row.person_b, row.relation_type));
  const actualRows = Array.isArray(rows) ? rows.filter(Boolean) : [];
  const actualPairKeys = actualRows
    .map(row => buildRelationshipPairKey(row.person_a, row.person_b, row.relation_type));
  const missingPairKeys = expectedPairKeys.filter(pairKey => !actualPairKeys.includes(pairKey));
  const statuses = uniqueList(actualRows
    .map(row => normalizeRelationshipStatus(row.friend_status || ''))
    .filter(Boolean));
  const invalidStatusRows = Boolean(options.requireActiveStatus)
    ? actualRows.filter(row => {
        const normalizedStatus = normalizeRelationshipStatus(row.friend_status || '');
        return normalizedStatus && normalizedStatus !== 'active';
      })
    : [];

  return {
    ok: missingPairKeys.length === 0 && invalidStatusRows.length === 0,
    persisted_pair_count: actualRows.length,
    missing_pair_keys: missingPairKeys,
    statuses,
    invalid_statuses: invalidStatusRows.map(row => ({
      person_a: row.person_a,
      person_b: row.person_b,
      relation_type: row.relation_type,
      friend_status: row.friend_status || null
    }))
  };
}

async function upsertFriendRelationships(supabase, relationshipRows = [], options = {}) {
  const includeMetadata = options.includeMetadata !== false;
  const payloadRows = includeMetadata
    ? relationshipRows
    : relationshipRows.map(row => ({
        person_a: row.person_a,
        person_b: row.person_b,
        relation_type: row.relation_type
      }));

  const { data, error } = await supabase
    .from('relationships')
    .upsert(payloadRows, { onConflict: 'person_a,person_b,relation_type' })
    .select('person_a, person_b, relation_type, friend_status');

  return {
    mode: includeMetadata ? 'metadata_upsert' : 'basic_upsert',
    rows: Array.isArray(data) ? data : [],
    error
  };
}

export async function confirmFriend(supabase, {
  ownerPersonId,
  friendPersonId = null,
  friendName = '',
  relationshipType = 'teman',
  introMessage = '',
  placeholderPersonId = null
} = {}) {
  if (!supabase || !ownerPersonId) {
    throw new Error('supabase dan ownerPersonId wajib tersedia.');
  }

  let resolvedFriendPersonId = friendPersonId;
  const normalizedFriendName = titleCaseName(friendName || '');
  const normalizedRelationshipType = normalizeRelation(relationshipType || 'teman') || 'teman';

  if (!resolvedFriendPersonId) {
    if (!normalizedFriendName) {
      throw new Error('friendName atau friendPersonId wajib tersedia.');
    }

    const { data: existingPerson, error: existingPersonError } = await supabase
      .from('persons')
      .select('id')
      .ilike('name', normalizedFriendName)
      .maybeSingle();

    if (existingPersonError) throw existingPersonError;

    if (existingPerson?.id) {
      resolvedFriendPersonId = existingPerson.id;
    } else {
      const { data: insertedPerson, error: insertPersonError } = await supabase
        .from('persons')
        .insert({
          name: normalizedFriendName,
          description: `Teman dari ${ownerPersonId}`
        })
        .select('id')
        .single();

      if (insertPersonError) throw insertPersonError;
      resolvedFriendPersonId = insertedPerson.id;
    }
  }

  if (!resolvedFriendPersonId) {
    throw new Error('friendPersonId tidak berhasil ditentukan.');
  }

  if (String(resolvedFriendPersonId) === String(ownerPersonId)) {
    return {
      confirmed: false,
      ownerPersonId,
      friendPersonId: resolvedFriendPersonId,
      relationshipType: normalizedRelationshipType,
      relationshipMode: 'blocked',
      relationshipValidation: {
        ok: false,
        persisted_pair_count: 0,
        missing_pair_keys: [],
        statuses: [],
        invalid_statuses: []
      },
      relationshipWarning: {
        code: 'self_relationship_blocked',
        message: 'ownerPersonId dan friendPersonId tidak boleh sama.'
      }
    };
  }

  const relationshipRows = [
    {
      person_a: ownerPersonId,
      person_b: resolvedFriendPersonId,
      relation_type: normalizedRelationshipType,
      friend_status: 'active',
      introduction_context: compactText(introMessage, 500) || null
    },
    {
      person_a: resolvedFriendPersonId,
      person_b: ownerPersonId,
      relation_type: normalizedRelationshipType,
      friend_status: 'active',
      introduction_context: compactText(introMessage, 500) || null
    }
  ];

  let relationshipPersisted = false;
  let relationshipWarning = null;
  let relationshipMode = 'metadata_upsert';
  let relationshipValidation = {
    ok: false,
    persisted_pair_count: 0,
    missing_pair_keys: relationshipRows.map(row => buildRelationshipPairKey(row.person_a, row.person_b, row.relation_type)),
    statuses: [],
    invalid_statuses: []
  };

  const primaryResult = await upsertFriendRelationships(supabase, relationshipRows, { includeMetadata: true });
  if (!primaryResult.error) {
    relationshipValidation = summarizeRelationshipValidation(primaryResult.rows, relationshipRows, {
      requireActiveStatus: true
    });
    relationshipPersisted = relationshipValidation.ok;
  }

  if (!relationshipPersisted) {
    relationshipMode = 'basic_upsert';
    const fallbackResult = await upsertFriendRelationships(supabase, relationshipRows, { includeMetadata: false });

    if (fallbackResult.error) {
      relationshipWarning = {
        code: fallbackResult.error.code || primaryResult.error?.code || 'relationship_upsert_failed',
        message: fallbackResult.error.message || primaryResult.error?.message || 'Unknown relationship upsert error',
        mode: relationshipMode,
        validation: relationshipValidation
      };
    } else {
      relationshipValidation = summarizeRelationshipValidation(fallbackResult.rows, relationshipRows, {
        requireActiveStatus: false
      });
      relationshipPersisted = relationshipValidation.ok;

      if (!relationshipPersisted) {
        relationshipWarning = {
          code: 'relationship_validation_failed',
          message: 'Upsert relasi tidak menghasilkan pasangan relasi lengkap.',
          mode: relationshipMode,
          validation: relationshipValidation
        };
      }
    }
  } else if (!relationshipValidation.ok) {
    relationshipWarning = {
      code: 'relationship_validation_failed',
      message: 'Relasi tersimpan tetapi status friend_status tidak valid.',
      mode: relationshipMode,
      validation: relationshipValidation
    };
    relationshipPersisted = false;
  }

  if (relationshipPersisted && (placeholderPersonId || normalizedFriendName)) {
    const placeholderKey = normalizedFriendName ? `mention_${toSlug(normalizedFriendName)}` : null;
    if (placeholderKey) {
      await supabase
        .from('person_memory')
        .update({
          status: 'archived',
          deleted_at: new Date().toISOString(),
          deletion_reason: 'friend_confirmed'
        })
        .eq('person_id', placeholderPersonId || ownerPersonId)
        .eq('key', placeholderKey)
        .eq('category', PROVISIONAL_FRIEND_CATEGORY);
    }
  }

  return {
    confirmed: relationshipPersisted,
    ownerPersonId,
    friendPersonId: resolvedFriendPersonId,
    relationshipType: normalizedRelationshipType,
    relationshipMode,
    relationshipValidation,
    relationshipWarning
  };
}
