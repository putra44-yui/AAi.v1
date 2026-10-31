# AAi — Alasan Perubahan Worker, Sesi, dan Model

Tanggal: 31 Oktober 2026
Repositori: `putra44-yui/AAi.v1`
Cabang: `design/aai-crystal-refresh`
Jenis: catatan keputusan rekayasa untuk audit dan calon bahan dataset AAi, **bukan** isi percakapan warga/pengguna.

## Latar belakang masalah

1. Build Next lama di Cloudflare berhenti pada `supabaseUrl is required` ketika menginisialisasi rute API. Migrasi ke Worker + aset statis menghapus kebutuhan menjalankan `next build`.
2. Migrasi awal memungkinkan streaming jawaban, tetapi mengeluarkan ID sesi sementara tanpa membuat `sessions` dan `messages` di Supabase. Akibatnya, daftar sesi, pemuatan ulang, dan riwayat percakapan tidak selaras.
3. Rute sesi lawas menginisialisasi Supabase lewat `process.env` pada tingkat modul. Rute edit/hapus juga tidak memeriksa pemilik sesi.
4. Respons pemuatan sesi yang terlambat bisa menimpa tampilan sesi yang baru dipilih pengguna.
5. Qwen3.6 Plus kurang ekonomis untuk penggunaan percakapan harian.
6. PWA menggunakan cache-first untuk JavaScript, sehingga klien yang pernah memasang service worker bisa tetap memuat kode lama setelah deploy. Daftar precache juga merujuk `ayaka1.gif` yang tidak ada, sehingga pemasangan cache dapat gagal.

7. Uji browser sesudah deploy menemukan `ERR_TOO_MANY_REDIRECTS` pada `/login`: Worker memberi HTTP 302 ke `/login.html`, tetapi Cloudflare Assets mengembalikan HTTP 307 ke URL kanonis `/login`. Kombinasi ini membuat login tidak bisa dibuka meski build dan unit test sebelumnya lulus.

## Keputusan, alasan, dan trade-off

| Bagian | Perubahan | Alasan dan batas |
| --- | --- | --- |
| Runtime | Tetap memakai `public/` + `src/worker.ts` di Cloudflare, tanpa Next saat build/runtime. | Sederhana dan sesuai target Cloudflare; arsip `app/`, `next.config.js`, dan `next-env.d.ts` masih disimpan tetapi tidak aktif. |
| TypeScript | Bersihkan plugin, include, dan alias Next di `tsconfig.json`; cakupan pemeriksaan hanya `src/**/*.ts`. | Menghilangkan ketergantungan build pada tipe Next yang tidak dipasang. |
| Sesi chat | Buat sesi nyata di DB, simpan pesan user sebelum stream, simpan jawaban assistant sebelum SSE `done`, lalu sentuh `updated_at`. | Menghilangkan sukses palsu. Jika model gagal, pesan user mungkin tetap tersimpan tanpa jawaban—ini keadaan yang perlu ditangani UI. |
| Riwayat ke model | Ikuti rantai `parent_id` pada cabang aktif; kirim maksimum **16 pesan**, masing-masing **2.400 karakter**, ke OpenRouter saat user mengirim pesan baru. | Memulihkan konteks, menghindari mencampur jawaban saudara hasil regenerate, membatasi biaya dan transmisi data. Pemilik memberi izin eksplisit untuk pengiriman konteks ini. |
| Kepemilikan | Periksa `user_id` untuk melihat, mengganti judul, mengedit pesan, dan menghapus sesi. | Mencegah kesalahan lintas pengguna secara fungsional. **Belum autentikasi yang kuat.** |
| Antarmuka | Abaikan respons loading sesi yang sudah usang; cek status HTTP rename/delete. | Meminimalkan race condition dan pembaruan optimistis yang diam-diam gagal. |
| Alias login | Hapus redirect khusus `/login` pada Worker; serahkan pemetaan `/login` ke Cloudflare Assets. | Memutus loop 302/307 dan mengikuti URL kanonis aset. Tes kontrak menjaga agar redirect buatan tidak muncul kembali; uji browser/HTTP tetap diperlukan karena redirect Cloudflare tak disimulasikan oleh unit test. |
| PWA | Naikkan versi cache shell, buang rujukan precache yang hilang, dan gunakan network-first untuk JS/CSS serta manifest dengan fallback offline. | Menghindari kode usang setelah deploy tanpa mengorbankan fallback saat offline. Tes memastikan semua precache benar-benar tersedia. |
| Model | Default `qwen/qwen3.8-omni-flash`; `openai/gpt-oss-20b:free` tetap hanya untuk mode uji. | Pemilik memilih Omni Flash; harga output yang ditemukan di OpenRouter sekitar USD **0,47/1 juta** dibanding Qwen3.6 Plus **1,95/1 juta**. Harga dapat berubah. |
| Rahasia | Secrets tetap di Cloudflare Runtime Variables and Secrets, tidak di Git. | Menghindari token masuk kode, bundle browser, atau dataset. |

## Risiko tersisa (jangan disembunyikan)

- **Login AAi masih hanya berdasarkan username.** `user_id` disimpan di localStorage dan dikirim klien, bukan identitas terverifikasi. Karena backend menggunakan `service_role` yang dapat melewati Supabase RLS, sistem **belum aman untuk pengguna umum atau data pribadi yang sensitif**. Sebelum peluncuran multi-user, gunakan Supabase Auth / autentikasi server yang benar dan turunkan hak akses sesuai kebutuhan.
- Rute warisan di `api_backup/` selain login dan sesi belum seluruhnya dimigrasikan. Uji file jobs, planning-memory, dan friends terpisah sebelum mengklaim seluruh fitur berfungsi.
- Riwayat yang dikirim ke OpenRouter dibatasi pada cabang dan jumlah pesan; sesi yang lebih panjang dapat kehilangan konteks awal. Model Omni Flash tidak otomatis mengaktifkan input audio/video karena payload chat sekarang masih berupa teks.
- Pengujian dengan fixture tidak membuktikan skema/prosedur Supabase produksi sepenuhnya cocok; diperlukan uji akun dummy tanpa mengubah sesi keluarga yang ada.
- Deployment mengikuti branch `design/aai-crystal-refresh`; jangan mengulang build dari `main` yang masih berisi Next lama.

## Rencana verifikasi

1. `npm test`: kontrak Worker, rantai sesi, penyimpanan pesan, model default, dan validasi ID.
2. `npx tsc --noEmit`: cek TypeScript Worker.
3. `npm run build`: Wrangler dry-run tanpa data produksi.
4. Setelah deploy: `/api/status`, login akun uji, buat chat, muat ulang halaman, pilih sesi lain, regenerate, rename, hapus **hanya sesi uji**.
5. Periksa `/login` di browser dan HEAD/GET URL untuk memastikan tidak ada siklus redirect; log status HTTP aktual.
6. Catat hasil uji runtime sebagai PASS/FAIL, jangan menganggap tes mock sama dengan uji produksi.

## Petunjuk kurasi dataset Benih AAi

Dokumen ini memberi contoh pola alasan perubahan `gejala → sebab → solusi → risiko → verifikasi`. Jika dimasukkan ke korpus:

- Label sumber `engineering_decision_log` dan bedakan keputusan dari hipotesis.
- Jangan memasukkan token, isi percakapan nyata, username, atau dump database.
- Pertahankan peringatan keamanan username-only dan sifat harga yang berubah.
- Hindari mengubah catatan ini menjadi contoh bahwa login tanpa autentikasi adalah praktik yang benar.

Sumber tarif (OpenRouter, diperiksa 31 Oktober 2026):

- https://openrouter.ai/qwen/qwen3.8-omni-flash
- https://openrouter.ai/qwen/qwen3.6-plus
- https://openrouter.ai/qwen/qwen3.5-flash-02-23
