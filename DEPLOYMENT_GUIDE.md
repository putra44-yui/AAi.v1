# Deployment AAi — Cloudflare Workers (tanpa Next.js)

AAi menggunakan **HTML/CSS/JavaScript statis** dari `public/` dan **Worker API native** dari `src/worker.ts`. Next.js tidak dipakai dalam build/deploy. Kode Next lama masih disimpan sementara untuk referensi dan rollback, tetapi tidak dijalankan.

## Pengaturan Cloudflare Builds

- Repository: `putra44-yui/AAi.v1`
- Branch untuk uji: `design/aai-crystal-refresh` (Draft PR #1, jangan mengira `main` sudah berisi perubahan)
- Worker name: `aai-v0` (sesuaikan `wrangler.jsonc` jika nama Worker Cloudflare berbeda)
- Build command: `npm run build` (melakukan Wrangler dry-run; tidak deploy)
- Deploy command: `npx wrangler deploy`
- Root directory: root repositori

Config di `wrangler.jsonc` mengatur Workers Static Assets dari `./public`, API routing `/api/*`, dan alias `/login`. Tidak membutuhkan Vite/React/Next untuk tampilan saat ini.

## Variabel dan secret — wajib sebelum tes fungsi

Tambahkan pada **Cloudflare → Workers & Pages → aai-v0 → Settings → Variables and Secrets**:

| Nama | Jenis | Perlu |
| --- | --- | --- |
| `SUPABASE_URL` | Variable atau Secret | Login, sessions, messages, file jobs |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret** | Endpoint Supabase server-side |
| `OPENROUTER_API_KEY` | **Secret** | Chat |
| `OPENROUTER_MAIN_MODEL` | Variable | Opsional; default `qwen/qwen3.6-plus` |
| `OPENROUTER_API_URL` | Variable | Opsional |
| `OPENROUTER_HTTP_REFERER`, `OPENROUTER_X_TITLE` | Variable | Opsional |

**Jangan unggah `.env.local`, `.dev.vars`, kunci service role, atau token ke GitHub**. `keep_vars: true` menjaga variables yang disetel via Dashboard saat deploy berikutnya. Jangan letakkan service role di frontend.

Untuk uji lokal, gunakan `.dev.vars` yang diabaikan Git (bukan file yang dikomit).

## Verifikasi bertahap

1. Build: `npm ci` lalu `npm run build`. Dry-run harus menghasilkan bundle Worker tanpa meminta `SUPABASE_URL` saat build.
2. Deploy lewat Cloudflare Builds atau `npx wrangler deploy`.
3. Cek `GET /api/status` → `{"ok":true,"runtime":"cloudflare-worker"}`.
4. Cek `/login` → `/login.html`, lalu login menggunakan akun uji.
5. Cek sesi, pesan, chat stream, tombol Stop, pembacaan riwayat, dan mode Qwen/OSS uji manual.
6. Cek fitur tambahan: planning memory, friends, lampiran, file jobs termasuk XLSX. **Fitur lama yang memakai pustaka Node belum diverifikasi di runtime Workers; jika gagal, kirim log sebelum produksi.**
7. Periksa tampilan pada desktop dan Android termasuk cache PWA. Cache service worker dinaikkan versinya agar CSS/maskot baru diambil.

## Pembatasan dan rollback

- Migrasi ini menghapus ketergantungan build Next; ini **bukan bukti** seluruh endpoint lama kompatibel dengan Workers. Adapter endpoint lama di-load saat dipanggil, agar secret Supabase yang belum disetel tidak menjatuhkan build.
- Saat environment belum lengkap, endpoint Supabase akan memberi 503 dengan pesan konfigurasi, bukan gagal saat kompilasi.
- Konfigurasi Capacitor masih menyimpan URL Vercel lama; ubah setelah domain Cloudflare final dan uji PWA. Jangan mengubahnya ke URL yang belum ada.
- Jangan merge ke `main` atau ganti Worker produksi sebelum checklist selesai. Branch/commit lama tetap bisa menjadi rollback.
