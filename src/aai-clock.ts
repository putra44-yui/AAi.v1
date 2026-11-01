export const DEFAULT_AAI_TIME_ZONE = 'Asia/Pontianak';

export function normalizeAAiTimeZone(input: unknown): string | null {
  if (typeof input !== 'string' || input.length > 64) return null;
  const value = input.trim();
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(value)) return null;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

export function buildAAiClockContext(timeZone: string | null, newConversation: boolean, now = new Date()): string {
  const fromDevice = normalizeAAiTimeZone(timeZone);
  const zone = fromDevice || DEFAULT_AAI_TIME_ZONE;
  const dateTime = new Intl.DateTimeFormat('id-ID', {
    timeZone: zone, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(now);
  const hour = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, hour: '2-digit', hourCycle: 'h23',
  }).format(now));
  const period = hour < 5 ? 'dini hari' : hour < 11 ? 'pagi' : hour < 15 ? 'siang'
    : hour < 18 ? 'sore' : hour < 22 ? 'malam' : 'larut malam';
  const zoneLabel = ['Asia/Pontianak', 'Asia/Jakarta'].includes(zone) ? 'WIB'
    : zone === 'Asia/Makassar' ? 'WITA' : zone === 'Asia/Jayapura' ? 'WIT' : zone;
  return '[WAKTU LOKAL KETIKA PESAN DITERIMA]\n'
    + 'Tanggal/jam: ' + dateTime + ' (' + zoneLabel + ', ' + zone + '). Bagian hari: ' + period + '.\n'
    + (fromDevice ? 'Zona waktu berasal dari pengaturan perangkat pengguna.'
      : 'Zona waktu perangkat tidak tersedia; ini perkiraan zona default WIB, bukan lokasi yang terverifikasi.')
    + '\nGunakan jam nyata ini bila ditanya waktu atau konteks hari relevan. Ini bukan jam live yang terus berjalan. '
    + 'Jangan mengarang lokasi, kebiasaan tidur, kegiatan, atau keadaan pengguna hanya dari jam. '
    + 'Jangan terus mengulang jam, mengomeli orang supaya tidur, atau mengalihkan pertanyaan serius.\n'
    + (newConversation
      ? 'Ini awal percakapan. Jika pengguna hanya menyapa atau ingin ngobrol tanpa topik, kamu boleh membuka diskusi secara hangat sesuai suasana waktu, termasuk celetukan ringan soal masih bangun saat larut malam. '
        + 'Contoh itu opsional, jangan diulang seperti template. Jika pengguna sudah punya pertanyaan, dahulukan jawabannya.'
      : 'Ini percakapan lanjutan. Pakai petunjuk waktu hanya saat relevan; jangan mengulang salam berdasarkan jam.');
}
