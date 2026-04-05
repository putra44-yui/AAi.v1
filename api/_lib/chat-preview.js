import { compactHistoryMessage } from './chat-context.js';

const AMBIGUOUS_TERMS = ['ini', 'itu', 'dia', 'mereka', 'yang tadi', 'kayak kemarin', 'seperti biasa'];
export const REASONING_STREAMING_TITLE = 'AAI sedang berpikir';
export const REASONING_FINAL_TITLE = 'AAI';

function uniqueList(items = []) {
  return [...new Set(items.filter(Boolean))];
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeEmotionText(text = '') {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(gk|ga|nggak|ngga|enggak|tak|ndak|ndak?)\b/g, ' tidak ')
    .replace(/\bku\b/g, ' aku ')
    .replace(/\bmenangis\b/g, ' nangis ')
    .replace(/\bcrying\b/g, ' nangis ')
    .replace(/\bhappy\b/g, ' senang ')
    .replace(/\bexcited\b/g, ' senang ')
    .replace(/\bstressed\b/g, ' stres ')
    .replace(/\bsad\b/g, ' sedih ')
    .replace(/\bangry\b/g, ' marah ')
    .replace(/\bpanic\b/g, ' panik ')
    .replace(/\bhelp me\b/g, ' tolong aku ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsWholeTerm(text = '', term = '') {
  if (!text || !term) return false;
  const escaped = String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(^|\\s)${escaped}(?=$|\\s)`, 'i').test(text);
}

function detectNegatedTerm(text = '', term = '') {
  if (!text || !term) return false;
  const escaped = String(term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:tidak|bukan|ga|gak|nggak|enggak|tak)\\s+${escaped}`, 'i').test(text);
}

function sliceTextAroundTerm(text = '', term = '', radius = 24) {
  if (!text || !term) return '';
  const index = text.indexOf(term);
  if (index < 0) return '';
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + term.length + radius);
  return text.slice(start, end).trim();
}

function pickFirstAvailable(items = []) {
  for (const item of items) {
    if (item) return item;
  }
  return '';
}

function formatQuotedEvidence(items = []) {
  const cleaned = uniqueList(items.map(item => String(item || '').trim()).filter(Boolean)).slice(0, 3);
  if (!cleaned.length) return '';
  return cleaned.map(item => `"${item}"`).join(', ');
}

const EMOTION_RULES = [
  {
    label: 'sedih',
    phrases: ['sedih', 'kecewa', 'nangis', 'galau', 'capek', 'lelah', 'drop', 'down', 'terpuruk', 'putus asa', 'stres', 'terluka', 'hancur']
  },
  {
    label: 'kesal',
    phrases: ['marah', 'kesal', 'jengkel', 'dongkol', 'sebal', 'muak', 'geram', 'emosi', 'kesel']
  },
  {
    label: 'cemas',
    phrases: ['cemas', 'khawatir', 'takut', 'bingung', 'panik', 'gimana ya', 'bagaimana ya', 'deg degan', 'degdegan']
  },
  {
    label: 'mendesak',
    phrases: ['segera', 'cepat', 'urgent', 'darurat', 'sekarang', 'asap', 'secepatnya']
  },
  {
    label: 'senang',
    phrases: ['senang', 'lega', 'bahagia', 'syukur', 'alhamdulillah', 'mantap', 'asik', 'happy', 'gembira']
  },
  {
    label: 'butuh_bantuan',
    phrases: ['tolong', 'bantu', 'bisa bantu', 'butuh bantuan', 'minta bantuan', 'help']
  }
];

function detectContrastMarkers(text = '') {
  if (!text) return [];
  return uniqueList([
    /\btapi\b/i.test(text) ? 'tapi' : '',
    /\bmeski\b/i.test(text) ? 'meski' : '',
    /\bwalau\b/i.test(text) ? 'walau' : '',
    /\bpadahal\b/i.test(text) ? 'padahal' : '',
    /\bnamun\b/i.test(text) ? 'namun' : '',
    /\bmeskipun\b/i.test(text) ? 'meskipun' : ''
  ]);
}

function buildEmotionSignal(rule, currentText, historyText) {
  const currentMatches = [];
  const historyMatches = [];
  let negatedCurrent = 0;
  let negatedHistory = 0;

  for (const phrase of rule.phrases) {
    if (containsWholeTerm(currentText, phrase)) {
      if (detectNegatedTerm(currentText, phrase)) negatedCurrent += 1;
      else currentMatches.push(phrase);
    }

    if (containsWholeTerm(historyText, phrase)) {
      if (detectNegatedTerm(historyText, phrase)) negatedHistory += 1;
      else historyMatches.push(phrase);
    }
  }

  const evidenceCurrent = uniqueList(currentMatches);
  const evidenceHistory = uniqueList(historyMatches);
  const score = evidenceCurrent.length * 2.2 + evidenceHistory.length * 0.8 - negatedCurrent * 1.6 - negatedHistory * 0.75;

  return {
    label: rule.label,
    score,
    evidence_current: evidenceCurrent,
    evidence_history: evidenceHistory,
    evidence: uniqueList([...evidenceCurrent, ...evidenceHistory]),
    fromHistory: evidenceHistory.length > 0,
    negated: negatedCurrent + negatedHistory,
    currentStrength: evidenceCurrent.length,
    historyStrength: evidenceHistory.length,
    snippet: pickFirstAvailable([
      sliceTextAroundTerm(currentText, evidenceCurrent[0]),
      sliceTextAroundTerm(historyText, evidenceHistory[0])
    ])
  };
}

function summarizeEmotionSignals(signals = [], contrastMarkers = []) {
  const sorted = [...signals].sort((left, right) => right.score - left.score);
  const positiveSignals = sorted.filter(signal => signal.score > 0.35);
  const primary = positiveSignals[0] || null;
  const secondary = positiveSignals.slice(1, 3);
  const topPair = positiveSignals.slice(0, 2);
  const mixed = topPair.length > 1 && (topPair[0].score - topPair[1].score <= 1.05 || contrastMarkers.length > 0);
  const contradiction = mixed && topPair.some(signal => signal.label === 'senang') && topPair.some(signal => ['sedih', 'kesal', 'cemas'].includes(signal.label));
  const caution = !primary || primary.score < 1.25 || contradiction;
  const confidence = primary
    ? clampNumber((primary.score + (mixed ? 0.25 : 0)) / 4.8, contradiction ? 0.38 : 0.45, 0.94)
    : 0.2;

  return {
    primary,
    secondary,
    mixed,
    contradiction,
    caution,
    confidence,
    all: sorted,
    contrast_markers: contrastMarkers,
    evidence_current: uniqueList(positiveSignals.flatMap(signal => signal.evidence_current)).slice(0, 5),
    evidence_history: uniqueList(positiveSignals.flatMap(signal => signal.evidence_history)).slice(0, 5)
  };
}

function buildEmotionOpening(analysis) {
  const primary = analysis.primary;
  const secondaryLabels = analysis.secondary.map(signal => signal.label);

  if (!primary) {
    if (analysis.evidence_history.length) {
      return 'Dari riwayat sebelumnya ada sedikit petunjuk soal suasana pesannya, tapi belum cukup kuat untuk kusimpulkan tegas.';
    }
    return '';
  }

  if (analysis.contradiction) {
    return 'Aku menangkap sinyal emosi yang campur dan agak saling tarik-menarik, jadi aku tidak mau buru-buru menyimpulkan satu rasa saja.';
  }

  if (analysis.mixed && secondaryLabels.length) {
    return `Ada lebih dari satu nada yang muncul di sini; yang paling terasa ${primary.label}, tapi ada jejak ${secondaryLabels.join(' dan ')} juga.`;
  }

  if (analysis.confidence < 0.56) {
    return `Aku baru menangkap kemungkinan ada nada ${primary.label}, tapi sinyalnya masih tipis.`;
  }

  const confidentOpenings = {
    sedih: 'Nuansa yang paling terasa di pesan ini cenderung berat atau rentan.',
    kesal: 'Aku menangkap ada nada kesal yang cukup jelas di balik cara pesannya disusun.',
    cemas: 'Pesan ini memberi kesan bahwa ada kekhawatiran atau kebingungan yang sedang menekan.',
    mendesak: 'Nada pesannya terasa mendesak, jadi aku perlu merespons tanpa berputar terlalu jauh.',
    senang: 'Ada energi yang lebih ringan dan positif di pesan ini.',
    butuh_bantuan: 'Yang paling terasa justru kebutuhan untuk dibantu dengan cepat dan jelas.'
  };

  return confidentOpenings[primary.label] || `Aku menangkap ada nada ${primary.label} di sini.`;
}

function buildEmotionEvidenceSentence(analysis) {
  const currentEvidence = formatQuotedEvidence(analysis.evidence_current);
  const historyEvidence = formatQuotedEvidence(analysis.evidence_history);

  if (currentEvidence && historyEvidence) {
    return `Petunjuknya muncul dari ${currentEvidence}, lalu riwayat sebelumnya ikut menguatkan lewat ${historyEvidence}.`;
  }

  if (currentEvidence) {
    return `Petunjuk utamanya datang dari ${currentEvidence}.`;
  }

  if (historyEvidence) {
    return `Aku lebih banyak menangkapnya dari riwayat obrolan sebelumnya, terutama dari ${historyEvidence}.`;
  }

  return '';
}

function buildEmotionReasoningStep(analysis) {
  const opening = buildEmotionOpening(analysis);
  const evidenceSentence = buildEmotionEvidenceSentence(analysis);
  const contrastSentence = analysis.contrast_markers.length
    ? ` Ada penanda kontras seperti ${formatQuotedEvidence(analysis.contrast_markers)}, jadi kubaca pesannya sebagai gabungan beberapa sinyal, bukan satu label tunggal.`
    : '';
  const cautionSentence = analysis.caution && !analysis.contradiction
    ? ' Karena sinyalnya belum bulat, aku jaga jawabanku supaya tidak mengklaim perasaan yang belum benar-benar pasti.'
    : '';

  return `${opening}${opening && evidenceSentence ? ' ' : ''}${evidenceSentence}${contrastSentence}${cautionSentence}`.trim();
}

function buildEmotionRuntimeGuidance(analysis) {
  if (!analysis?.primary) {
    return {
      summary: 'Belum ada sinyal emosi yang cukup kuat. Jawab natural, jangan mengasumsikan perasaan user, dan utamakan klarifikasi jika konteks emosinya penting.',
      confidence: 0.2,
      primary_emotion: 'netral',
      secondary_emotions: [],
      mixed: false,
      contradiction: false,
      needs_caution: true,
      evidence: []
    };
  }

  const summaryParts = [
    `Sinyal utama: ${analysis.primary.label}.`,
    analysis.secondary.length ? `Sinyal tambahan: ${analysis.secondary.map(signal => signal.label).join(', ')}.` : '',
    analysis.contradiction
      ? 'Bacaan emosi bersifat campuran/kontradiktif, jadi validasi dengan hati-hati dan jangan menegaskan satu emosi seolah pasti.'
      : analysis.caution
        ? 'Bacaan emosi masih tentatif; boleh memakai nada peka, tapi hindari klaim yang terlalu pasti.'
        : 'Gunakan validasi emosi secara halus sebelum masuk ke inti jawaban.',
    analysis.evidence_current.length
      ? `Bukti utama dari pesan sekarang: ${analysis.evidence_current.slice(0, 3).join(', ')}.`
      : '',
    analysis.evidence_history.length
      ? `Riwayat yang relevan: ${analysis.evidence_history.slice(0, 2).join(', ')}.`
      : ''
  ];

  return {
    summary: summaryParts.filter(Boolean).join(' '),
    confidence: analysis.confidence,
    primary_emotion: analysis.primary.label,
    secondary_emotions: analysis.secondary.map(signal => signal.label),
    mixed: analysis.mixed,
    contradiction: analysis.contradiction,
    needs_caution: analysis.caution,
    evidence: uniqueList([...analysis.evidence_current, ...analysis.evidence_history]).slice(0, 5)
  };
}

export function collectMatchedTerms(text = '', phrases = []) {
  const normalized = normalizeEmotionText(text);
  if (!normalized) return [];
  return uniqueList((phrases || []).filter(term => normalized.includes(String(term).toLowerCase())));
}

export function detectConversationEmotion(userMessage = '', recentHistory = []) {
  const currentText = normalizeEmotionText(userMessage);
  const historyText = (recentHistory || [])
    .slice(-4)
    .map(row => normalizeEmotionText(row?.content || ''))
    .join(' \n ');

  const contrastMarkers = detectContrastMarkers(currentText);
  const signals = EMOTION_RULES.map(rule => buildEmotionSignal(rule, currentText, historyText));
  const analysis = summarizeEmotionSignals(signals, contrastMarkers);
  const primary = analysis.primary;

  return {
    label: primary?.label || 'netral',
    opening: buildEmotionOpening(analysis),
    evidence: uniqueList([...analysis.evidence_current, ...analysis.evidence_history]),
    evidence_current: analysis.evidence_current,
    evidence_history: analysis.evidence_history,
    fromHistory: analysis.evidence_history.length > 0,
    score: primary?.score || 0,
    confidence: analysis.confidence,
    confidence_label: analysis.confidence >= 0.76 ? 'tinggi' : analysis.confidence >= 0.52 ? 'sedang' : 'rendah',
    primary_emotion: primary?.label || 'netral',
    secondary_emotions: analysis.secondary.map(signal => signal.label),
    mixed: analysis.mixed,
    contradiction: analysis.contradiction,
    needs_caution: analysis.caution,
    contrast_markers: analysis.contrast_markers,
    signals: analysis.all,
    runtime_guidance: buildEmotionRuntimeGuidance(analysis),
    reasoning_step: buildEmotionReasoningStep(analysis)
  };
}

export function detectReasoningIntent(userMessage = '', fileContext = '', targetPersona = '') {
  const normalized = normalizeEmotionText(userMessage);
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

export function buildReasoningSteps({
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
    steps.push(emotion.reasoning_step || buildEmotionReasoningStep({
      primary: emotion.signals?.find(signal => signal.label === emotion.label) || null,
      secondary: [],
      mixed: false,
      contradiction: false,
      caution: !!emotion.needs_caution,
      confidence: emotion.confidence || 0.2,
      evidence_current: emotion.evidence_current || [],
      evidence_history: emotion.evidence_history || [],
      contrast_markers: emotion.contrast_markers || []
    }));
  } else if (relevantHistory.length > 0) {
    steps.push('Aku lihat dulu nada obrolan sebelumnya supaya jawabanku tidak meleset dari suasana percakapannya.');
  } else if (/\?|tolong|bisa|jelaskan|buatkan|perbaiki|cek|lihat/i.test(normalized)) {
    steps.push('Belum ada emosi yang cukup kuat untuk kusimpulkan, jadi aku fokus dulu ke kebutuhan yang paling jelas dari pesannya.');
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
    if (intent.key === 'emotional' && emotion.label !== 'netral') {
      const toneHint = emotion.needs_caution
        ? 'Jadi aku perlu menjaga nada yang peka tanpa mengunci satu tafsir emosi terlalu cepat.'
        : 'Jadi jawabanku perlu tetap empatik sebelum masuk ke inti saran.';
      steps.push(toneHint);
    } else {
      steps.push(intent.step);
    }
  }

  if (targetPersona === 'Coding') {
    steps.push('Karena ini terasa teknis, aku usahakan jawabannya langsung bisa dipakai, bukan cuma teori.');
  } else if (intent.key === 'emotional' && emotion.label === 'netral') {
    steps.push('Aku pilih jawaban yang tetap lembut, biar pesannya terasa menolong dulu sebelum memberi arah.');
  }

  if (steps.length < 2) {
    steps.push('Aku ambil jalur jawaban yang paling aman dulu, lalu kalau perlu baru kuperjelas lebih jauh.');
  }

  return uniqueList(
    steps
      .map(step => String(step || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
  ).slice(0, Math.max(4, emotion.mixed || ambiguityPayload?.show_preview ? 6 : 5));
}

export function buildRuntimeEmotionGuidance(userMessage = '', recentHistory = []) {
  return detectConversationEmotion(userMessage, recentHistory).runtime_guidance;
}

export function buildLegacyReasoningSteps(previewPayload = {}) {
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

export function buildClientPreviewPayload(previewPayload = null) {
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

export function analyzeAmbiguityPreview(userMessage, currentPerson, allPersons = []) {
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
