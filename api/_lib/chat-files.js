import * as XLSX from 'xlsx';

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

export function buildWorkbookBufferFromSheetBlocks(sheetBlocks = []) {
  const sheetsToBuild = buildSandingWorkbookSheets(sheetBlocks);
  const wb = XLSX.utils.book_new();

  for (const sheet of sheetsToBuild) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.rows);
    applyWorksheetColumnWidths(ws, sheet.rows);
    XLSX.utils.book_append_sheet(wb, ws, sheet.name.slice(0, 31));
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsb' });
}
