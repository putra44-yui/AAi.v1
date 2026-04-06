/**
 * speech-style.js
 * Menganalisa pola komunikasi user dari satu pesan atau histori percakapan.
 * Hasilnya diinjeksi ke system prompt agar AI memahami HOW user berkomunikasi,
 * bukan hanya WHAT yang dikatakan.
 */

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Hitung telemetri sinyal dari satu pesan user.
 * Signal ini ringan (tidak ada regex berat), bisa dipanggil per request tanpa overhead.
 *
 * @param {string} message - Pesan mentah user
 * @param {Date|string|null} sentAt - Waktu pesan dikirim (opsional, default now)
 * @returns {object} telemetry
 */
export function computeMessageTelemetry(message = '', sentAt = null) {
  const text = String(message || '').trim();
  if (!text) return _emptyTelemetry();

  const words = text.split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?؟]+/).filter(s => s.trim().length > 0);
  const questionMarks = (text.match(/\?/g) || []).length;
  const exclamations = (text.match(/!/g) || []).length;
  const ellipses = (text.match(/\.{2,}/g) || []).length;
  const capsWords = (words.filter(w => w === w.toUpperCase() && /[A-Z]/.test(w))).length;
  const emojiCount = (text.match(/\p{Emoji_Presentation}|\p{Extended_Pictographic}/gu) || []).length;
  const slashCount = (text.match(/\//g) || []).length;

  // Kata urgensi
  const urgencyTokens = (text.match(
    /\b(segera|cepat|urgent|darurat|sekarang|asap|secepatnya|buru[- ]buru|takut|panik|tolong|help|butuh|perlu)\b/gi
  ) || []).length;

  // Kata informal / casual
  const casualTokens = (text.match(
    /\b(sih|deh|dong|nih|lho|lah|ya|yuk|hayuk|gw|gue|lo|lu|wkwk|haha|hehe|hahaha|iya|oke|ok)\b/gi
  ) || []).length;

  // Kata reflektif / introspektif
  const reflectiveTokens = (text.match(
    /\b(kenapa|mengapa|gimana|bagaimana|sebenarnya|sebenernya|perasaan|aku merasa|rasa|pikirku|kubilang|kupikir|kurasa|aku mau|aku ingin|aku harap)\b/gi
  ) || []).length;

  // Waktu pengiriman — jam lokal (UTC+7 WIB)
  const ts = sentAt ? new Date(sentAt) : new Date();
  const hourWIB = (ts.getUTCHours() + 7) % 24;
  const timeSlot = classifyTimeSlot(hourWIB);

  return {
    wordCount: words.length,
    sentenceCount: sentences.length,
    avgWordLength: words.length
      ? Number((words.reduce((s, w) => s + w.length, 0) / words.length).toFixed(2))
      : 0,
    questionCount: questionMarks,
    exclamationCount: exclamations,
    ellipsesCount: ellipses,
    capsRatio: words.length ? Number((capsWords / words.length).toFixed(3)) : 0,
    emojiCount,
    slashCount,
    urgencyScore: clamp(urgencyTokens / 3, 0, 1),
    casualScore: clamp(casualTokens / 5, 0, 1),
    reflectiveScore: clamp(reflectiveTokens / 3, 0, 1),
    hourWIB,
    timeSlot
  };
}

/**
 * Klasifikasikan jam WIB ke slot waktu naratif.
 */
function classifyTimeSlot(hour) {
  if (hour >= 4 && hour < 9)  return 'pagi';
  if (hour >= 9 && hour < 12) return 'pagi_kerja';
  if (hour >= 12 && hour < 14) return 'siang';
  if (hour >= 14 && hour < 17) return 'sore_kerja';
  if (hour >= 17 && hour < 20) return 'sore';
  if (hour >= 20 && hour < 23) return 'malam';
  return 'larut_malam';  // 23-04
}

function _emptyTelemetry() {
  return {
    wordCount: 0, sentenceCount: 0, avgWordLength: 0,
    questionCount: 0, exclamationCount: 0, ellipsesCount: 0,
    capsRatio: 0, emojiCount: 0, slashCount: 0,
    urgencyScore: 0, casualScore: 0, reflectiveScore: 0,
    hourWIB: 0, timeSlot: 'tidak_diketahui'
  };
}

/**
 * Hitung profil gaya komunikasi user dari histori pesan terbaru.
 * Dipanggil per request dengan recentHistory (array {role, content}).
 * Tidak perlu DB — cukup dari histori dalam konteks sesi.
 *
 * @param {Array}  recentHistory  - Array {role:'user'|'assistant', content}
 * @param {string} currentMessage - Pesan user saat ini
 * @returns {object} profile
 */
export function buildSpeechProfile(recentHistory = [], currentMessage = '') {
  const userMessages = (Array.isArray(recentHistory) ? recentHistory : [])
    .filter(m => m.role === 'user')
    .map(m => String(m.content || ''));

  // Tambah pesan saat ini sebagai yang paling baru
  if (currentMessage) userMessages.push(String(currentMessage));

  if (userMessages.length === 0) return _emptyProfile();

  const telemetries = userMessages.map(msg => computeMessageTelemetry(msg));
  const n = telemetries.length;

  const avg = key => Number((telemetries.reduce((s, t) => s + t[key], 0) / n).toFixed(3));

  const avgWordCount   = avg('wordCount');
  const avgQuestions   = avg('questionCount');
  const avgUrgency     = avg('urgencyScore');
  const avgCasual      = avg('casualScore');
  const avgReflective  = avg('reflectiveScore');
  const avgEmoji       = avg('emojiCount');
  const avgCapsRatio   = avg('capsRatio');

  // === Gaya komunikasi ===
  const formality = deriveFormality(avgCasual, avgCapsRatio, avgEmoji);
  const messageLength = deriveMessageLength(avgWordCount);
  const questioningStyle = deriveQuestioningStyle(avgQuestions, avgWordCount);
  const urgencyTendency = avgUrgency > 0.35 ? 'sering_mendesak'
    : avgUrgency > 0.15 ? 'kadang_mendesak'
    : 'jarang_mendesak';
  const reflectiveStyle = avgReflective > 0.4 ? 'introspektif'
    : avgReflective > 0.15 ? 'semi_reflektif'
    : 'langsung';

  // === Deteksi perubahan mendadak (anomali gaya) ===
  const currentTelemetry = computeMessageTelemetry(currentMessage);
  const styleShift = detectStyleShift(currentTelemetry, {
    avgWordCount, avgUrgency, avgCasual, avgQuestions
  });

  // === Topik berulang dari pesan user (kata kunci paling sering) ===
  const recurrentTopics = extractRecurrentTopics(userMessages);

  // === Slot waktu dominan ===
  const timeSlotCounts = {};
  for (const t of telemetries) {
    timeSlotCounts[t.timeSlot] = (timeSlotCounts[t.timeSlot] || 0) + 1;
  }
  const dominantTimeSlot = Object.entries(timeSlotCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'tidak_diketahui';
  const currentTimeSlot = currentTelemetry.timeSlot;
  const timeAnomaly = dominantTimeSlot !== 'tidak_diketahui' && currentTimeSlot !== dominantTimeSlot
    && currentTimeSlot === 'larut_malam';

  return {
    sampleCount: n,
    formality,
    messageLength,
    questioningStyle,
    urgencyTendency,
    reflectiveStyle,
    styleShift,
    recurrentTopics,
    dominantTimeSlot,
    currentTimeSlot,
    timeAnomaly,
    raw: {
      avgWordCount, avgQuestions, avgUrgency,
      avgCasual, avgReflective, avgEmoji, avgCapsRatio
    }
  };
}

function deriveFormality(avgCasual, avgCapsRatio, avgEmoji) {
  const casualPressure = avgCasual * 0.5 + avgEmoji * 0.05 + avgCapsRatio * 0.2;
  if (casualPressure > 0.35) return 'sangat_informal';
  if (casualPressure > 0.18) return 'informal';
  if (casualPressure > 0.06) return 'semi_formal';
  return 'formal';
}

function deriveMessageLength(avgWords) {
  if (avgWords >= 60) return 'panjang';
  if (avgWords >= 25) return 'sedang';
  if (avgWords >= 8)  return 'pendek';
  return 'sangat_pendek';
}

function deriveQuestioningStyle(avgQ, avgWords) {
  const density = avgWords > 0 ? avgQ / avgWords : 0;
  if (density > 0.15 || avgQ >= 3) return 'banyak_pertanyaan';
  if (density > 0.05 || avgQ >= 1.5) return 'beberapa_pertanyaan';
  return 'jarang_bertanya';
}

/**
 * Deteksi apakah pesan saat ini berbeda mencolok dari pola historis.
 * Returns list of signal strings jika ada anomali, atau array kosong.
 */
function detectStyleShift(current, baselines) {
  const signals = [];

  // Pesan mendadak lebih panjang dari biasanya (> 3x rata-rata)
  if (baselines.avgWordCount > 8 && current.wordCount > baselines.avgWordCount * 3) {
    signals.push('pesan_jauh_lebih_panjang_dari_biasanya');
  }
  // Urgency naik tiba-tiba padahal biasanya rendah
  if (baselines.avgUrgency < 0.15 && current.urgencyScore > 0.5) {
    signals.push('urgency_mendadak_tinggi');
  }
  // Dari sangat casual jadi sangat formal (tidak ada kata casual sama sekali)
  if (baselines.avgCasual > 0.3 && current.casualScore === 0 && current.wordCount > 8) {
    signals.push('gaya_mendadak_formal');
  }
  // Dari jarang tanya jadi banyak tanya
  if (baselines.avgQuestions < 0.5 && current.questionCount >= 4) {
    signals.push('mendadak_banyak_pertanyaan');
  }

  return signals;
}

/**
 * Ambil topic berulang (kata bukan stopword yang muncul ≥2x).
 */
function extractRecurrentTopics(messages = []) {
  const STOPWORDS = new Set([
    'dan', 'yang', 'di', 'ke', 'dari', 'untuk', 'dengan', 'ini', 'itu', 'ada',
    'aku', 'saya', 'kamu', 'dia', 'kita', 'kami', 'mereka', 'ya', 'yg', 'juga',
    'sudah', 'sudah', 'bisa', 'kalau', 'jadi', 'tapi', 'atau', 'mau', 'buat',
    'aja', 'sih', 'deh', 'dong', 'nih', 'lah', 'lho', 'ok', 'oke', 'iya',
    'gimana', 'bagaimana', 'kenapa', 'karena', 'jangan', 'tidak', 'ga', 'gak',
    'boleh', 'harus', 'akan', 'lagi', 'punya', 'banyak', 'banget', 'sekali',
    'coba', 'sekarang', 'nanti', 'saja', 'hanya', 'lebih', 'masih', 'terus',
    'then', 'the', 'and', 'or', 'of', 'to', 'is', 'in', 'it', 'a', 'an', 'be'
  ]);

  const freq = {};
  for (const msg of messages) {
    const words = String(msg || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 3 && !STOPWORDS.has(w));

    for (const w of words) {
      freq[w] = (freq[w] || 0) + 1;
    }
  }

  return Object.entries(freq)
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([word]) => word);
}

function _emptyProfile() {
  return {
    sampleCount: 0,
    formality: 'tidak_diketahui',
    messageLength: 'tidak_diketahui',
    questioningStyle: 'tidak_diketahui',
    urgencyTendency: 'jarang_mendesak',
    reflectiveStyle: 'langsung',
    styleShift: [],
    recurrentTopics: [],
    dominantTimeSlot: 'tidak_diketahui',
    currentTimeSlot: 'tidak_diketahui',
    timeAnomaly: false,
    raw: {}
  };
}

/**
 * Ubah profile object menjadi teks ringkasan untuk dimasukkan ke system prompt.
 * Model tidak perlu struct — cukup teks naratif singkat.
 *
 * @param {object} profile - Output buildSpeechProfile()
 * @param {string} personName - Nama user
 * @returns {string} Teks block siap injeksi
 */
export function buildSpeechStyleBlock(profile = {}, personName = 'user') {
  if (!profile || profile.sampleCount === 0) return '';

  const lines = [
    `[POLA KOMUNIKASI ${String(personName).toUpperCase()}]`,
    `Gaya bahasa    : ${labelFormality(profile.formality)}`,
    `Panjang pesan  : ${labelLength(profile.messageLength)}`,
    `Gaya tanya     : ${labelQuestioning(profile.questioningStyle)}`,
    `Urgensi        : ${labelUrgency(profile.urgencyTendency)}`,
    `Pola ekspresi  : ${labelReflective(profile.reflectiveStyle)}`,
    `Slot waktu aktif: ${profile.dominantTimeSlot}, sekarang: ${profile.currentTimeSlot}`
  ];

  if (profile.recurrentTopics.length > 0) {
    lines.push(`Topik berulang  : ${profile.recurrentTopics.join(', ')}`);
  }

  if (profile.styleShift.length > 0) {
    lines.push('');
    lines.push('⚠️ PERUBAHAN GAYA TIBA-TIBA TERDETEKSI:');
    for (const s of profile.styleShift) {
      lines.push(`  - ${s.replace(/_/g, ' ')}`);
    }
    lines.push('→ Ini bisa tanda situasi khusus. Perhatikan konteks lebih seksama dan respons dengan empati.');
  }

  if (profile.timeAnomaly) {
    lines.push('');
    lines.push(`⚠️ User menghubungi di waktu tidak biasa (${profile.currentTimeSlot} padahal dominan ${profile.dominantTimeSlot}).`);
    lines.push('→ Berikan respons yang lebih perhatian dan tanyakan apakah semua baik-baik saja jika relevan.');
  }

  lines.push('');
  lines.push('Gunakan profil ini untuk menyesuaikan NADA dan CARA bicara, bukan untuk berasumsi fakta baru.');

  return lines.join('\n');
}

function labelFormality(v) {
  return { sangat_informal: 'sangat santai/informal', informal: 'santai', semi_formal: 'semi-formal', formal: 'formal', tidak_diketahui: '-' }[v] || v;
}
function labelLength(v) {
  return { panjang: 'panjang (suka detail)', sedang: 'sedang', pendek: 'pendek/ringkas', sangat_pendek: 'sangat pendek', tidak_diketahui: '-' }[v] || v;
}
function labelQuestioning(v) {
  return { banyak_pertanyaan: 'sering bertanya', beberapa_pertanyaan: 'kadang bertanya', jarang_bertanya: 'jarang bertanya', tidak_diketahui: '-' }[v] || v;
}
function labelUrgency(v) {
  return { sering_mendesak: 'sering terasa mendesak', kadang_mendesak: 'kadang mendesak', jarang_mendesak: 'biasanya santai' }[v] || v;
}
function labelReflective(v) {
  return { introspektif: 'reflektif/introspektif', semi_reflektif: 'semi-reflektif', langsung: 'langsung ke poin' }[v] || v;
}
