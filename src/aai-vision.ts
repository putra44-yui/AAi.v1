/**
 * AAi multimodal ingress. Uploads are untrusted transient content:
 * validated data URLs go to the selected model, never to web search,
 * logs, chat DB columns, or saved activity traces.
 */
export type VisionImage = Readonly<{
  name: string;
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  dataUrl: string;
  size: number;
}>;

export type VisionVideo = Readonly<{
  name: string;
  mime: 'video/mp4';
  dataUrl: string;
  size: number;
}>;

export type VisionContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'video_url'; video_url: { url: string } };

export const VISION_MAX_IMAGES = 3;
export const VISION_MAX_VIDEOS = 1;
export const VISION_MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const VISION_MAX_VIDEO_BYTES = 8 * 1024 * 1024;
export const VISION_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
export const VISION_MAX_BODY_BYTES = 12 * 1024 * 1024;

type ValidMedia = { ok: true; images: VisionImage[]; videos: VisionVideo[] };
type InvalidMedia = { ok: false; error: string };

function decodeDataUrl(url: unknown, mime: string): { raw: string; size: number } | null {
  if (typeof url !== 'string') return null;
  const prefix = 'data:' + mime + ';base64,';
  if (!url.startsWith(prefix)) return null;
  const raw = url.slice(prefix.length);
  if (!raw || raw.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null;
  const padding = raw.endsWith('==') ? 2 : raw.endsWith('=') ? 1 : 0;
  const size = raw.length / 4 * 3 - padding;
  return size > 0 ? { raw, size } : null;
}

function hasValidImageMagic(mime: VisionImage['mime'], base64: string): boolean {
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

function hasValidMp4Magic(base64: string): boolean {
  try {
    const header = atob(base64.slice(0, 24));
    return header.length >= 12 && header.slice(4, 8) === 'ftyp';
  } catch {
    return false;
  }
}

function safeName(value: unknown, fallback: string): string {
  return typeof value === 'string'
    ? (value.replace(/[\r\n\0<>]/g, '').slice(0, 100) || fallback)
    : fallback;
}

export function parseMediaFiles(files: unknown): ValidMedia | InvalidMedia {
  if (files === undefined || files === null) return { ok: true, images: [], videos: [] };
  if (!Array.isArray(files)) return { ok: false, error: 'Lampiran tidak valid.' };
  if (files.length > VISION_MAX_IMAGES + VISION_MAX_VIDEOS) {
    return { ok: false, error: 'Maksimal tiga gambar dan satu video untuk satu pesan.' };
  }

  const images: VisionImage[] = [];
  const videos: VisionVideo[] = [];
  let totalBytes = 0;

  for (const file of files) {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      return { ok: false, error: 'Format lampiran tidak valid.' };
    }
    const value = file as Record<string, unknown>;
    const rawMime = value.type;
    const mime = rawMime === 'image/jpg' ? 'image/jpeg' : rawMime;

    if (mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp') {
      if (images.length >= VISION_MAX_IMAGES) {
        return { ok: false, error: 'Maksimal tiga gambar untuk satu pesan.' };
      }
      const decoded = decodeDataUrl(value.base64, mime);
      if (!decoded) return { ok: false, error: 'Data gambar tidak valid atau tipe dan isinya tidak cocok.' };
      if (decoded.size > VISION_MAX_IMAGE_BYTES) {
        return { ok: false, error: 'Satu gambar maksimal 4 MB. Kecilkan dulu fotonya, ya.' };
      }
      totalBytes += decoded.size;
      if (totalBytes > VISION_MAX_TOTAL_BYTES) {
        return { ok: false, error: 'Total lampiran maksimal 8 MB.' };
      }
      if (!hasValidImageMagic(mime, decoded.raw)) {
        return { ok: false, error: 'Format gambar tidak cocok dengan isi berkas.' };
      }
      images.push({
        name: safeName(value.name, 'gambar'),
        mime,
        size: decoded.size,
        dataUrl: value.base64 as string,
      });
      continue;
    }

    if (mime === 'video/mp4') {
      if (videos.length >= VISION_MAX_VIDEOS) {
        return { ok: false, error: 'Maksimal satu video MP4 untuk satu pesan.' };
      }
      const decoded = decodeDataUrl(value.base64, mime);
      if (!decoded) return { ok: false, error: 'Data video tidak valid atau tipe dan isinya tidak cocok.' };
      if (decoded.size > VISION_MAX_VIDEO_BYTES) {
        return { ok: false, error: 'Satu video MP4 maksimal 8 MB untuk saat ini.' };
      }
      totalBytes += decoded.size;
      if (totalBytes > VISION_MAX_TOTAL_BYTES) {
        return { ok: false, error: 'Total lampiran maksimal 8 MB.' };
      }
      if (!hasValidMp4Magic(decoded.raw)) {
        return { ok: false, error: 'Format video tidak cocok. Gunakan video MP4 yang valid.' };
      }
      videos.push({
        name: safeName(value.name, 'video.mp4'),
        mime: 'video/mp4',
        size: decoded.size,
        dataUrl: value.base64 as string,
      });
      continue;
    }

    return { ok: false, error: 'AAi menerima foto JPG/PNG/WebP dan video MP4.' };
  }

  return { ok: true, images, videos };
}

export function buildVisionContent(
  message: string,
  images: VisionImage[],
  videos: VisionVideo[] = [],
): string | VisionContentPart[] {
  if (!images.length && !videos.length) return message;
  return [
    { type: 'text', text: message },
    ...images.map(image => ({ type: 'image_url' as const, image_url: { url: image.dataUrl } })),
    ...videos.map(video => ({ type: 'video_url' as const, video_url: { url: video.dataUrl } })),
  ];
}
