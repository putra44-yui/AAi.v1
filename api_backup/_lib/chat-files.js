import * as XLSX from 'xlsx';

const FILE_BLOCK_PATTERN = /\[FILE_START:(.+?)\]([\s\S]*?)\[FILE_END\]/g;

export async function uploadFileToStorage({ supabase, base64String, fileName, mimeType }) {
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

export async function extractPdfText(buffer) {
  let parser = null;

  try {
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

export function sanitizeGeneratedFileBlock(content = '') {
  let clean = String(content || '').replace(/\r/g, '').trim();
  clean = clean.replace(/^```[a-zA-Z0-9_-]*\n?/i, '').replace(/\n?```$/, '');
  return clean.trim();
}

export function toSlug(input = '') {
  return String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function normalizeCellValue(value) {
  return String(value == null ? '' : value)
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

export function pickBestDelimiter(line = '') {
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

export function parseDelimitedLines(rawContent = '') {
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

export function parseXlsbRows(rawContent = '') {
  return parseDelimitedLines(rawContent);
}

export function parseSheetBlocks(rawContent = '') {
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

export function findJoinColumnIndex(headersA = [], headersB = []) {
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

export function buildSandingWorkbookSheets(sheetBlocks = []) {
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

export function applyWorksheetColumnWidths(ws, rows = []) {
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

export function buildWorkbookBufferFromSheetBlocks(sheetBlocks = [], options = {}) {
  const sheetsToBuild = buildSandingWorkbookSheets(sheetBlocks);
  const wb = XLSX.utils.book_new();
  const bookType = String(options?.bookType || 'xlsx').trim().toLowerCase() || 'xlsx';

  for (const sheet of sheetsToBuild) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    applyWorksheetColumnWidths(ws, sheet.rows);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }

  return XLSX.write(wb, { type: 'buffer', bookType });
}

function resolveSpreadsheetFormat(ext = '') {
  const normalized = String(ext || '').trim().toLowerCase();

  if (normalized === 'xlsb') {
    return {
      bookType: 'xlsb',
      contentType: 'application/vnd.ms-excel.sheet.binary.macroEnabled.12'
    };
  }

  if (normalized === 'xls') {
    return {
      bookType: 'biff8',
      contentType: 'application/vnd.ms-excel'
    };
  }

  return {
    bookType: 'xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  };
}

function createFileBlockRegex() {
  return new RegExp(FILE_BLOCK_PATTERN.source, FILE_BLOCK_PATTERN.flags);
}

function normalizeReplySpacing(text = '') {
  return String(text || '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractGeneratedFileBlocks(sourceText = '') {
  const text = String(sourceText || '');
  const regex = createFileBlockRegex();
  const blocks = [];
  let match;

  while ((match = regex.exec(text)) !== null) {
    const filename = String(match[1] || '').trim();
    const content = sanitizeGeneratedFileBlock(match[2]);
    const ext = filename.includes('.') ? filename.split('.').pop().toLowerCase() : '';

    if (!filename) continue;

    blocks.push({
      rawBlock: match[0],
      filename,
      content,
      ext
    });
  }

  return blocks;
}

export function buildPendingFileReply(sourceText = '') {
  const blocks = extractGeneratedFileBlocks(sourceText);
  if (!blocks.length) {
    return {
      hasFiles: false,
      pendingReply: normalizeReplySpacing(sourceText),
      files: []
    };
  }

  let pendingReply = String(sourceText || '');

  for (const block of blocks) {
    pendingReply = pendingReply.replace(
      block.rawBlock,
      `\n\n⏳ File **${block.filename}** sedang disiapkan. Link download akan muncul otomatis setelah proses selesai.\n\n`
    );
  }

  pendingReply = normalizeReplySpacing(pendingReply);
  if (!pendingReply) {
    pendingReply = normalizeReplySpacing([
      '⏳ Sedang menyiapkan file yang kamu minta:',
      ...blocks.map((block, index) => `${index + 1}. ${block.filename}`)
    ].join('\n'));
  }

  return {
    hasFiles: true,
    pendingReply,
    files: blocks.map(block => ({ filename: block.filename, ext: block.ext }))
  };
}

async function buildGeneratedFileBuffer({ filename, content, ext }) {
  if (ext === 'txt') {
    return {
      buffer: Buffer.from(content, 'utf-8'),
      contentType: 'text/plain'
    };
  }

  if (ext === 'bas' || ext === 'vba') {
    return {
      buffer: Buffer.from(content.replace(/\n/g, '\r\n'), 'utf-8'),
      contentType: 'text/plain'
    };
  }

  if (ext === 'xlsb' || ext === 'xlsx' || ext === 'xls') {
    const parsedSheets = parseSheetBlocks(content);
    if (!parsedSheets.length) {
      throw new Error('Konten tabel kosong. Gunakan format kolom dengan pemisah # di setiap baris.');
    }

    const spreadsheetFormat = resolveSpreadsheetFormat(ext);

    return {
      buffer: buildWorkbookBufferFromSheetBlocks(parsedSheets, { bookType: spreadsheetFormat.bookType }),
      contentType: spreadsheetFormat.contentType
    };
  }

  if (ext === 'docx') {
    const docx = await import('docx');
    const paragraphs = String(content || '')
      .split('\n')
      .map(line => new docx.Paragraph({
        children: [new docx.TextRun({ text: line, font: 'Arial', size: 24 })]
      }));

    const doc = new docx.Document({ sections: [{ children: paragraphs }] });
    return {
      buffer: await docx.Packer.toBuffer(doc),
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    };
  }

  return {
    buffer: Buffer.from(content, 'utf-8'),
    contentType: 'text/plain'
  };
}

export async function processGeneratedFiles({ supabase, sourceText = '' }) {
  const blocks = extractGeneratedFileBlocks(sourceText);
  if (!blocks.length) {
    return {
      hasFiles: false,
      processedReply: normalizeReplySpacing(sourceText),
      files: []
    };
  }

  let processedReply = String(sourceText || '');
  const files = [];

  for (const block of blocks) {
    try {
      const built = await buildGeneratedFileBuffer(block);
      const filePath = `generations/${Date.now()}-${block.filename}`;

      const { error } = await supabase.storage.from('aai-files').upload(filePath, built.buffer, {
        contentType: built.contentType,
        upsert: false
      });

      if (error) {
        throw new Error(error.message);
      }

      const { data: { publicUrl } } = supabase.storage.from('aai-files').getPublicUrl(filePath);
      processedReply = processedReply.replace(block.rawBlock, `📥 **[Download ${block.filename}](${publicUrl})**`);
      files.push({ filename: block.filename, status: 'ready', url: publicUrl });
    } catch (error) {
      processedReply = processedReply.replace(block.rawBlock, `⚠️ Error: ${error.message}`);
      files.push({ filename: block.filename, status: 'failed', error: error.message });
    }
  }

  return {
    hasFiles: true,
    processedReply: normalizeReplySpacing(processedReply),
    files
  };
}

export function buildFailedFileReply(pendingText = '', errorMessage = '') {
  const trimmed = String(errorMessage || '').trim();
  const detail = trimmed ? ` Detail: ${trimmed.slice(0, 180)}` : '';

  return normalizeReplySpacing([
    String(pendingText || '').trim(),
    `⚠️ Ada kendala saat menyiapkan file. Coba ulangi permintaan file ini.${detail}`
  ].filter(Boolean).join('\n\n'));
}
