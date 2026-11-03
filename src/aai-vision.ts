/**
 * AAi vision ingress. Treat uploads as untrusted transient content:
 * validated data URLs go to the selected vision model, never to web search,
 * logs, chat DB columns, or saved activity traces.
 */
export type VisionImage = Readonly<{
  name: string;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  dataUrl: string;
  size: number;
}>;

export type VisionContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export const VISION_MAX_IMAGES = 3;
export const VISION_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const VISION_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
export const VISION_MAX_BODY_BYTES = 12 * 1024 * 1024;

type ValidImages = { ok: true; images: VisionImage[] };
type InvalidImages = { ok: false; error: string };

function hasValidMagic(mime: VisionImage['mime'], base64: string): boolean {
  let first: string;
  try { first = atob(base64.slice(0, 44)); } catch { return false; }
  const byte = (index: number): number => first.charCodeAt(index);
  if (mime === 'image/png') {
    return [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => byte(i) === n);
  }
  if (mime === 'image/jpeg') {
    return byte(0) === 0xff && byte(1) === 0xd8 && byte(2) === 0xff;
  }
  return first.slice(0, 4) === 'RIFF' && first.slice(8, 12) === 'WEBP';
}

export function parseVisionFiles(files: unknown): ValidImages | InvalidImages {
  if (files === undefined || files === null) return { ok: true, images: [] };
  if (!Array.isArray(files)) return { ok: false, error: 'Lampiran tidak valid.' };
  if (files.length > VISION_MAX_IMAGES) {
    return { ok: false, error: 'Maksimal 3 gambar untuk satu pesan.' };
  }
  const images: VisionImage[] = [];
  let totalBytes = 0;
  for (const file of files) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      return { ok: false, error: 'Format lampiran tidak valid.' };
    }
    const value = file as Record<string, unknown>;
    const mime = value.type === 'image/jpg' ? 'image/jpeg' : value.type;
    if (mime !== 'image/jpeg' && mime !== 'image/png' && mime !== 'image/webp') {
      return { ok: false, error: 'Saat ini AAi hanya bisa membaca foto JPG, PNG, atau WebP.' };
    }
    const url = value.base64;
    if (typeof url !== 'string') return { ok: false, error: 'Data gambar tidak ditemukan.' };
    const prefix = 'data:' + mime + ';base64,';
    if (!url.startsWith(prefix)) return { ok: false, error: 'Tipe dan isi gambar tidak cocok.' };
    const raw = url.slice(prefix.length);
    if (!raw || raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) {
      return { ok: false, error: 'Encoding gambar tidak valid.' };
    }
    const padding = raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0;
    const size = raw.length / 4 * 3 - padding;
    if (size <= 0 || size > VISION_MAX_IMAGE_BYTES) {
      return { ok: false, error: 'Satu gambar maksimal 4 MB. Kecilkan dulu fotonya, ya.' };
    }
    totalBytes += size;
    if (totalBytes > VISION_MAX_TOTAL_BYTES) {
      return { ok: false, error: 'Total lampiran gambar maksimal 8 MB.' };
    }
    if (!hasValidMagic(mime, raw)) {
      return { ok: false, error: 'Format gambar tidak cocok dengan isi berkas.' };
    }
    const name = typeof value.name === 'string'
      ? value.name.replace(/[\r\n\0<>]/g, '').slice(0, 100) : 'gambar';
    images.push({ name: name || 'gambar', mime, size, dataUrl: url });
  }
  return { ok: true, images };
}

export function buildVisionContent(message: string, images: VisionImage[]): string | VisionContentPart[] {
  if (!images.length) return message;
  return [
    { type: 'text', text: message },
    ...images.map(image => ({ type: 'image_url' as const, image_url: { url: image.dataUrl } })),
  ];
}
