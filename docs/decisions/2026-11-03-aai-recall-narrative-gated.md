# ADR 2026-11-03 — Recall memori bertahap dan aktivitas percakapan

Status: **pencarian memori dan gerbang autentikasi di branch eksperimen; belum diaktifkan di produksi**
Dataset label: `aai_recall_conversational_activity_gated_v1`
Repo: `putra44-yui/AAi.v1`
Perubahan terkait: `src/aai-context.ts`, `src/chat.ts`, `tests/aai-memory.test.mjs`, `tests/session-flow.test.mjs`

## Latar belakang

Pengguna ingin aktivitas AAi berupa dialog yang menjelaskan apa yang sedang dikerjakan, bukan panel JSON teknis. Contoh perilaku yang diminta: “Bentar, aku coba ingat lagi ...”, lalu melaporkan pencarian lanjutan, hasil, atau keterbatasannya. Jawaban harus tetap dikirim sebagai token streaming. Pada konteks sebelumnya AAi hanya memilih sampai 14 catatan dari 140 memori awal, sehingga permintaan mengingat janji lama bisa kehilangan konteks.

## Keputusan eksperimen

1. Deteksi permintaan mengingat percakapan lampau secara eksplisit. Pertanyaan biasa atau instruksi menyimpan fakta baru tidak memulai pencarian tambahan.
2. Jika izin fitur aktif dan `person_id` dari catatan pengguna tersedia, query `person_memory` dengan filter `person_id` dan `status=active`; jendela maksimal 420 baris, ranking relevansi leksikal, maksimum **8 catatan tambahan** ke provider. Singkirkan ID yang sudah masuk konteks awal serta kunci/kategori yang jelas berisi credential/secret. Tidak ada query lintas orang.
3. Laporkan langkah nyata lewat event SSE `progress` (`strategy`, `memory`, `sources`, `unavailable`) dalam bahasa awam. Isinya hanya jumlah/status, tidak berisi isi memori, kredensial, atau pertimbangan internal model. Untuk web, laporan tambahan hanya dipancarkan setelah tool benar-benar dipilih/dijalankan serta hasil benar-benar datang.
4. Simpan jejak aktivitas terukur seperti sebelumnya di `activity_trace`; tetap gunakan tampilan percakapan, bukan JSON mentah untuk pengguna keluarga.

## Gerbang keamanan — wajib sebelum aktivasi

Audit menemukan login saat ini masih berbasis username dan API masih menerima `user_id` dari klien tanpa bukti sesi pengguna. Filter `person_id` pada query hanya membatasi data berdasarkan ID yang disuplai lapisan aplikasi; **itu belum membuktikan siapa pemanggilnya**.

Karena itu `AAI_RECALL_SEARCH_ENABLED` **harus tidak disetel** dalam produksi dan default-nya OFF. Jika pengguna meminta ingatan lama ketika flag OFF, AAi melaporkan bahwa pencarian tambahan belum diaktifkan dan tetap menjawab dari konteks yang telah tersedia. **Jangan merge/aktifkan fitur untuk penggunaan keluarga publik sampai autentikasi server diperbaiki.**

Syarat aktivasi:
- Login dengan bukti identitas nyata (misalnya Supabase Auth atau session yang diverifikasi server).
- API chat, sesi, pesan, memori dan endpoint legacy menurunkan identitas dari sesi terverifikasi, bukan memercayai ID dari browser.
- Uji negatif: permintaan dengan ID orang lain harus ditolak sebelum akses data atau panggilan model.
- Baru setelah uji negatif lulus, pertimbangkan mengaktifkan flag dan uji recall pribadi secara sadar.

## Uji dan batasan

- `npm test`: 80/80 lulus, termasuk integrasi SSE dengan Supabase dan provider sintetis.
- `npx tsc --noEmit --allowImportingTsExtensions`: lulus.
- Ranking pencarian memori masih berbasis kecocokan kata, belum pencarian semantik atau penelusuran tanpa batas. Tidak menemukan catatan bukan berarti janji itu tidak pernah terjadi.
- Tidak ada memori keluarga asli yang dipakai dalam fixture pengujian.

## Alternatif dan alasan

- Menyuntikkan seluruh memori ke model: ditolak; mahal, rawan salah konteks, dan memperbesar paparan data.
- Menampilkan JSON teknis ke pengguna: ditolak; tidak membantu percakapan keluarga.
- Menyalakan recall tanpa login terverifikasi: ditunda karena masalah otorisasi yang teridentifikasi.

## Rollback

Biarkan flag OFF untuk mematikan pencarian tambahan tanpa mengubah gaya aktivitas lain. Jika observability atau latensi memburuk, revert PR; sistem memori awal tetap dipakai seperti sebelumnya.

## Implementasi autentikasi terverifikasi (lanjutan, 3 Nov 2026)

- `src/aai-auth.ts` memverifikasi JWT dengan Supabase Auth `auth.getUser(jwt)` (atau refresh sesi), kemudian mengambil `aai_user_id` dari **app_metadata** yang hanya dapat disetel administrator, bukan `user_metadata` atau `user_id` dari browser.
- Cookie `__Host-aai_access` dan `__Host-aai_refresh` memakai `HttpOnly; Secure; SameSite=Strict`. Permintaan mutasi harus memiliki header `Origin` yang sama. ID yang diklaim oleh klien tetapi tidak cocok dengan sesi ditolak dengan 403.
- Di `src/worker.ts`, semua endpoint `/api/*` selain status, konfigurasi dan login wajib memakai sesi terverifikasi ketika `AAI_AUTH_REQUIRED=true`. Jalur lama menerima identitas yang telah disanitasi; akses `file-jobs` mengecek kepemilikan job/session sebelum konten dibaca atau diproses.
- `public/login.html` punya mode email + kata sandi (aktif setelah flag dihidupkan); localStorage tetap hanya cache tampilan, bukan bukti autentikasi. `public/assets/js/app.js` memeriksa `/api/me` serta menjalankan `/api/logout` saat keluar.
- Mode transisi `AAI_AUTH_REQUIRED` default **OFF** agar 4 akun lama tidak terkunci mendadak. Saat OFF, Worker memaksa `AAI_RECALL_SEARCH_ENABLED='false'` meskipun variabel recall salah konfigurasi. **Mode transisi tetap tidak aman untuk data pribadi; jangan klaim terlindungi atau perluas pengguna.**
- Pada audit basis data: ada **4 akun legacy**, **37 sesi**, dan **0 akun di `auth.users`**. Pendaftaran akun Auth harus dituntaskan sebelum cutover. Tidak ada password baru dibuat dalam commit/chat.
- RLS tabel utama sudah aktif, tetapi sebagian besar belum mempunyai kebijakan, sedangkan backend menggunakan service role yang melewati RLS; karena itu server authorization wajib konsisten. Supabase advisor juga menunjukkan peringatan mutable search_path pada beberapa fungsi, dicatat sebagai audit terpisah tanpa mengubah schema saat ini.

### Prosedur cutover yang wajib

1. Administrator menyiapkan 4 akun Supabase Auth dengan alamat email yang sah dan password unik melalui kanal privat; **nonaktifkan self-registration publik** agar pengguna baru tidak otomatis terhubung ke akun keluarga lama.
2. Administrator mencocokkan identitas setiap akun Auth dengan akun legacy secara terpisah dan memasang `app_metadata.aai_user_id` memakai Admin API (`updateUserById`), bukan field metadata yang boleh diedit pengguna. Lakukan verifikasi satu per satu; jangan menebak berdasarkan nama depan.
3. Validasi per akun: login aman, `/api/me` mengembalikan ID legacy yang benar, semua sesi lama dapat diakses, akun A tidak bisa membaca/mengubah akun B, file-job lintas akun 404, dan logout memutus cookie lokal.
4. Baru set `AAI_AUTH_REQUIRED=true` di Cloudflare, deploy dan tes PWA/HP. Setelah semua pengujian keamanan lulus, baru set `AAI_RECALL_SEARCH_ENABLED=true` dan uji alur recall tambahan. Pada rollback, **jangan** mengaktifkan legacy tanpa sadar karena akan membuka lagi celah akses.

### Catatan tes

- `tests/aai-auth.test.mjs` membuktikan permintaan tanpa sesi ditolak, Origin lintas situs ditolak, body/query user_id palsu tidak menggantikan owner, serta request token akun A tidak boleh dipakai untuk sesi B.
- Secara sengaja belum ada pengujian dengan kredensial keluarga asli; fixture tes memakai identitas sintetis.
- Verifikasi CI terbaru wajib dibaca sebelum merge; status hijau di branch awal bukan jaminan kode autentikasi tambahan sudah lulus.
