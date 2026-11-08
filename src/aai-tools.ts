/** Narrow, validated model-initiated tool protocol for AAi. */
export interface NativeToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export const SEARCH_WEB_TOOL = {
  type: 'function',
  function: {
    name: 'search_web',
    description: 'Model menentukan sendiri apakah informasi publik perlu diverifikasi; jangan menunggu kata pemicu seperti "cari" atau "web". Gunakan tanggal/waktu lokal pada konteks sistem. Cari untuk berita dan peristiwa terkini, status/jabatan yang dapat berubah, aturan yang masih berlaku, jadwal, harga, kurs, cuaca, ketersediaan, pengumuman, versi/rilis, dokumentasi yang berubah, atau fakta setelah pengetahuan model. Berita publik tentang pejabat, termasuk dugaan penyadapan, peretasan, atau kebocoran komunikasi yang telah diberitakan, tetap boleh dicari dari sumber terbuka; jangan mencoba masuk ke akun atau mengambil isi pesan nonpublik. Jangan cari untuk pengetahuan stabil, hitungan, penulisan kreatif, atau pertanyaan yang hanya meminta ingatan pribadi pengguna. Jangan mencari hanya karena topik sama pernah dicari; pernyataan, koreksi, pengalaman langsung, dan klarifikasi pengguna bukan permintaan investigasi kecuali mereka meminta verifikasi. Buat query spesifik berisi entitas dan detail (nomor/tahun dokumen, versi, tanggal, pasal, atau fakta). Sistem memilih domain resmi atau penerbit relevan dan mempertahankan urutan sumber resmi lalu media pembanding bila diminta. Jangan kirim identitas pribadi dari memori AAi, kredensial, atau isi dokumen rahasia. Jawab langsung tanpa tool bila pengetahuan dan konteks sudah cukup.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Query pencarian publik yang ringkas dan bebas kredensial/data pribadi (3–500 karakter).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
} as const;

export function addNativeToolDeltas(target: Map<number, NativeToolCall>, raw: unknown): void {
  if (!Array.isArray(raw)) return;
  for (const delta of raw) {
    if (!delta || typeof delta !== 'object') continue;
    const item = delta as Record<string, unknown>;
    const index = item.index;
    if (!Number.isInteger(index) || (index as number) < 0 || (index as number) > 3) continue;
    const key = index as number;
    const previous = target.get(key) || { id: '', type: 'function' as const, function: { name: '', arguments: '' } };
    if (typeof item.id === 'string' && item.id) previous.id = item.id.slice(0, 160);
    const fn = item.function;
    if (fn && typeof fn === 'object') {
      const fields = fn as Record<string, unknown>;
      if (typeof fields.name === 'string' && fields.name) {
        if (!previous.function.name || !previous.function.name.endsWith(fields.name)) {
          previous.function.name = (previous.function.name + fields.name).slice(0, 80);
        }
      }
      if (typeof fields.arguments === 'string') {
        previous.function.arguments = (previous.function.arguments + fields.arguments).slice(0, 1200);
      }
    }
    target.set(key, previous);
  }
}

export function completedNativeToolCalls(target: Map<number, NativeToolCall>): NativeToolCall[] {
  return [...target.entries()].sort(([a], [b]) => a - b).map(([, call]) => call)
    .filter(call => !!call.id && !!call.function.name);
}

export function extractSearchWebQuery(call: NativeToolCall): string | null {
  if (call.type !== 'function' || call.function.name !== 'search_web') return null;
  try {
    const parsed: unknown = JSON.parse(call.function.arguments);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const args = parsed as Record<string, unknown>;
    if (Object.keys(args).some(key => key !== 'query')) return null;
    const query = typeof args.query === 'string' ? args.query.replace(/\s+/g, ' ').trim() : '';
    return query.length >= 3 && query.length <= 500 ? query : null;
  } catch { return null; }
}

/** Model-authored tool prefaces are not evidence that a search has happened. */
export function sanitizeUnverifiedToolOpening(text: string): string {
  const opening = text.replace(/\s+/g, ' ').trim().slice(0, 240);
  if (!opening) return '';
  // The search provider (not the model) reports whether anything was found.
  if (/\b(?:hasil\s+(?:pencarian(?:nya)?|penelusuran(?:nya)?|web)|(?:berita|sumber|referensi)\s+(?:yang\s+)?(?:ditemukan|terkumpul|masuk|kosong)|(?:sudah|telah|tadi|barusan)\s+(?:aku\s+)?(?:mencari|cari|mengecek|cek|menemukan|membaca|mengakses)|(?:tidak|nggak|gak|belum)\s+(?:ada|menemukan|ketemu)\s+(?:berita|sumber|hasil))\b/i.test(opening)) return '';
  return opening;
}

/** A raw tool/query payload must never become a human-facing answer. */
export function looksLikeUnexecutedSearchPayload(text: string): boolean {
  const value = text.trim();
  if (!value) return false;
  if (/^(?:\{\s*"(?:query|tool_calls|name)"\s*:|(?:search_web|tool_call|function_call)\s*[:({]|<\|tool_call)/i.test(value)) return true;
  // A standalone search phrase, especially with "terbaru" or a year, is not a reply.
  return value.length <= 140 && !/[.!?\n]/.test(value)
    && /\b(?:berita|pencarian|cari|search|latest|terbaru|update)\b/i.test(value)
    && /\b(?:terbaru|latest|20\d{2}|hari\s+ini)\b/i.test(value);
}
