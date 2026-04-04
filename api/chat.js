export const maxDuration = 300;
import * as XLSX from 'xlsx';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import { createClient } from '@supabase/supabase-js';

let Document, Packer, Paragraph, TextRun;
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const MAIN_MODEL = "qwen/qwen3.6-plus:free";
const MEMORY_TAG_PREFIX = '[MEMORY:';
const CLARIFY_BLOCK_START = '[AAI_CLARIFY]';
const CLARIFY_BLOCK_END = '[/AAI_CLARIFY]';
const MAX_HISTORY_MESSAGES = 7;
const MAX_HISTORY_MESSAGES_COMPACT = 60;
const HISTORY_SUMMARY_MAX_MESSAGES = 6;
const HISTORY_SUMMARY_MAX_CHARS = 260;
const CHECKPOINT_SUMMARY_START = '[SESSION_CHECKPOINT]';
const CHECKPOINT_SUMMARY_END = '[/SESSION_CHECKPOINT]';

const AMBIGUOUS_TERMS = ['ini', 'itu', 'dia', 'mereka', 'yang tadi', 'kayak kemarin', 'seperti biasa'];

function uniqueList(items = []) {
  return [...new Set(items.filter(Boolean))];
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

      const tagStartIndex = buffer.indexOf(MEMORY_TAG_PREFIX);
      if (tagStartIndex !== -1) {
        visible += buffer.slice(0, tagStartIndex);
        buffer = buffer.slice(tagStartIndex + MEMORY_TAG_PREFIX.length);
        suppressingMemoryTag = true;
        continue;
      }

      if (flush) {
        visible += buffer;
        buffer = '';
        break;
      }

      const safeLength = Math.max(0, buffer.length - (MEMORY_TAG_PREFIX.length - 1));
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
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText({ lineEnforce: true });
    const text = String(result?.text || '').replace(/\n{3,}/g, '\n\n').trim();
    return text;
  } finally {
    await parser.destroy().catch(() => {});
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
      .from('person_memory').select('key, value').eq('person_id', user.person_id);
    const memoryText = memories?.map(m => `${m.key}: ${m.value}`).join('\n') || 'Tidak ada memori.';

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
    if (/sayang|cinta/i.test(msgLower) && targetPersona !== 'Rosalia')
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

Memori permanen:\n${memoryText}

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
- Jika kamu mendeteksi fakta baru tentang ${person?.name} (kebiasaan, preferensi, gaya komunikasi, topik favorit, cara belajar, emosi, pola kerja, dll), sisipkan tag memori di AKHIR responmu (setelah semua isi jawaban):
  [MEMORY:key=value]
- Contoh key yang berguna: gaya_komunikasi, topik_favorit, cara_belajar, jam_aktif, bahasa_sering_dipakai, masalah_berulang, preferensi_jawaban, karakter_umum
- Contoh: [MEMORY:preferensi_jawaban=suka langsung ke kode tanpa penjelasan panjang]
- Maksimal 2 tag [MEMORY:...] per respons.
- Jangan duplikasi fakta yang sudah ada di "Memori permanen" di atas.
- Jika fakta yang sudah ada ternyata berubah/salah, tulis ulang dengan key yang sama dan value yang diperbarui.
- Tag [MEMORY:...] adalah instruksi sistem, JANGAN tampilkan ke user, letakkan di paling akhir respons.`
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

        // ── OPENROUTER CALL + DETAILED LOGGING ──
    console.log(`[OpenRouter] Mengirim request ke model: ${MAIN_MODEL}`);

    const aiResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://aai.family',
        'X-Title': 'AAi Keluarga'
      },
      body: JSON.stringify({
  model: MAIN_MODEL,
  messages: [
    systemPrompt,
    ...(compactInstructionPrompt ? [compactInstructionPrompt] : []),
    ...chatHistory,
    {
      role: "user",
      content: `${userMessage}${fileContext ? `\n\n📎 LAMPIRAN FILE:\n${fileContext}` : ''}`
    }
  ],
  stream: true,
  temperature: modelConfig.temperature,
  max_tokens: modelConfig.max_tokens,
  top_p: modelConfig.top_p
})
    });

    console.log(`[OpenRouter] Status response: ${aiResponse.status} ${aiResponse.statusText}`);

    if (!aiResponse.ok) {
      let errorDetail = 'Unknown error';
      try {
        const errData = await aiResponse.json();
        errorDetail = JSON.stringify(errData, null, 2);
        console.error(`[OpenRouter] ERROR DETAIL:`, errData);
      } catch (e) {
        errorDetail = await aiResponse.text();
        console.error(`[OpenRouter] Raw error text:`, errorDetail);
      }

      res.write(`data: ${JSON.stringify({ error: `Provider returned error - ${aiResponse.status} ${errorDetail}` })}\n\n`);
      res.end();
      return;
    }

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
      // ── PARSE & STRIP [MEMORY:key=value] TAGS ──
      const memoryTagRegex = /\[MEMORY:([^\]=\n]+)=([^\]\n]+)\]/g;
      const detectedMemories = [];
      let cleanReply = fullReply;
      let memMatch;
      while ((memMatch = memoryTagRegex.exec(fullReply)) !== null) {
        const key = memMatch[1].trim().toLowerCase().replace(/\s+/g, '_');
        const value = memMatch[2].trim();
        if (key && value) detectedMemories.push({ key, value });
        cleanReply = cleanReply.replace(memMatch[0], '');
      }
      cleanReply = cleanReply.trimEnd();

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
        preview: shouldShowPreview ? previewPayload : null
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

      // ── UPSERT MEMORI AI SECARA BACKGROUND ──
      if (detectedMemories.length > 0 && user.person_id) {
        for (const mem of detectedMemories) {
          try {
            const { data: existing } = await supabase
              .from('person_memory')
              .select('id, observation_count')
              .eq('person_id', user.person_id)
              .eq('key', mem.key)
              .maybeSingle();

            if (existing) {
              await supabase.from('person_memory')
                .update({ value: mem.value, source_message_id: aiMsgData?.id })
                .eq('id', existing.id);
            } else {
              await supabase.from('person_memory')
                .insert({
                  person_id: user.person_id,
                  key: mem.key,
                  value: mem.value,
                  confidence: 0.7,
                  observation_count: 1,
                  source_message_id: aiMsgData?.id
                });
            }
            console.log(`[Memory] Upsert "${mem.key}" for person ${user.person_id}`);
          } catch (memErr) {
            console.error(`[Memory] Gagal upsert "${mem.key}":`, memErr.message);
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