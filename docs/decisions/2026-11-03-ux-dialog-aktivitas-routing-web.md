# AAi v0 — UX Dialog Aktivitas dan Routing Web (tanpa Vision)
Tanggal: 2026-11-03
Status: eksperimen P0/P1, bukan instruksi untuk mengaktifkan recall privat.
Branch: feat/aai-human-activity-search-20261103
Base: design/aai-crystal-refresh

## Masalah yang diverifikasi
1. Pada HP, panel proses menampilkan log router seperti "Menghubungi model untuk menyiapkan jawaban...", "Model terhubung; menunggu kata pertama...", "Mengingat 3/14 catatan...", "Menyiapkan jawaban...", "Memeriksa apakah perlu mencari...". Daftar ini mendominasi layar serta terasa robotik. Screenshot pengguna adalah bukti penerimaan UX.
2. Prompt "BOAT coba cari dulu" tidak terdeteksi sebagai `explicit_search`. "Cari web" memang terdeteksi, tetapi izin web tetap harus ON dan kuota/provider tersedia.
3. Kebutuhan pengguna bukan membuka private chain of thought dan bukan token counter: ia menginginkan laporan pendek yang dialogis sebelum, selama dan setelah kerja nyata.
4. Pembacaan screenshot/foto **ditunda atas instruksi pengguna**. Jangan membuat klaim vision bekerja pada rilis ini.

## Kontrak data (pisah tanggung jawab)
- **Trace internal**: `progress`, `at_ms`, provider/model status, memori count, keputusan router, sumber yang diverifikasi. Trace tersimpan untuk audit/dataset, bukan teks UI.
- **Narasi publik**: hanya hal yang benar-benar sedang dilakukan/dilakukan: pembuka `preface` pada niat web eksplisit yang valid; `tool_switch` jika model berpindah ke tool; `tavily/exa/found/sources` saat pencarian berlangsung; `report` jika pencarian kedua benar-benar diputuskan; `unavailable` bila tool gagal. Jangan mengaku telah mencari saat belum ada eksekusi.
- **Jawaban**: `token` SSE tetap mengalir ke bubble; tidak menggantikan laporan tool.
- **Penyimpanan**: raw trace disimpan terbatas seperti sebelumnya. Saat memuat sesi lama, juga **filter** status router legacy sehingga tidak muncul pada layar keluarga.

## UX layar pengguna
- Percakapan sederhana, tanpa tool: tidak perlu daftar status/angka memori; bubble cukup menampilkan jawaban.
- Permintaan web eksplisit dengan izin: AAi boleh bilang "Bentar, aku cari sumbernya dulu, ya." (rencana, belum klaim sukses). Saat tool benar-benar mulai: "Menelusuri web..."; selesai: "Ketemu N sumber, aku cek isinya." Jika pencarian kedua benar-benar berjalan: "Masih kurang pas, aku cari pembandingnya." Saat sudah selesai: ringkaskan "Penelusuran selesai" dengan chevron untuk detail hasil dan sumber. Jangan paksa panel terbuka saat event masuk.
- Jika izin pencarian web belum diberikan: jangan mencari atau mengaku mencari; jawab secara manusiawi cara memberi izin dengan tombol +.
- Jika hasil kosong/tool error: sampaikan batasan secara benar, tanpa sumber palsu.
- Jangan tampilkan `assess/provider/memory/compose` atau jumlah catatan pada UI keluarga; itu tetap ada di trace internal.
- Tanpa web search permission, pertanyaan yang sederhana harus langsung mengalir tanpa preface/proses.
- Reporter boleh memakai kalimat pembuka model yang sudah disanitasi, tetapi tidak boleh membuka hidden reasoning atau angka internal.
- Panel hasil pencarian tertutup secara bawaan. Jika pengguna memilih membuka, jangan otomatis mengubahnya ke `open` saat event baru.

## Perintah pencarian
- `BOAT coba cari dulu`, `coba cari dulu`, `cari lagi`, `cek dulu di web`, `cari web`, `carikan sumber resmi` adalah intent pencarian eksplisit.
- `jangan cari web`, `tanpa web`, `jawab dari bobot saja` override semua sinyal pencarian.
- `cari ide cerita` atau `mencari kerja` bukan otomatis perintah menelusuri internet.
- Selalu hormati izin pengguna: `web_permission: deny` tidak bisa diganti oleh prompt, router, atau model.
- Search hanya boleh mengirim query publik yang lolos pemeriksaan privasi. Jangan mengirim memori keluarga ke Tavily/Exa.
- Deteksi eksplisit memilih `tool_choice: required` (jika izin/provider tersedia); jangan tampilan sukses sebelum benar-benar mendapat hasil.

## Acceptance & regresi
1. `decideWebSearch('BOAT coba cari dulu')` explicit true; kalimat negatif false.
2. `decideWebSearch('cari ide cerita')` false, `cek dulu di web` true.
3. Tanpa izin web -> tidak menjalankan provider, user diberi batasan.
4. Trace yang hanya mengandung `provider/assess/memory/compose` tidak menghasilkan elemen langkah kerja publik.
5. Trace `tavily,found,sources` menghasilkan langkah singkat; ikon dan tautan sumber tetap berfungsi.
6. Komponen lama yang tersimpan memfilter status teknis juga.
7. Streaming `token` tetap lancar; panel tidak memakan satu layar HP.
8. Tidak ada regresi pada file-job, sesi, histori dan tool permission.
9. Jalankan `npm test`, pemeriksaan sintaks, Wrangler dry-run, GitHub Actions CI, lalu uji browser live bila di-deploy.
10. Pengujian memakai prompt sintetis. Jangan menyentuh data rahasia atau memori pribadi saat menguji.

## Batas scope dan rollback
- Tidak menyentuh pembacaan gambar; UI upload gambar tidak diaktifkan sebagai fungsi vision baru.
- Tidak mengaktifkan recall memory; PR #8 tetap independen dan menunggu autentikasi kuat.
- Jika UI merusak SSE/fungsi pencarian, rollback branch deploy dan simpan bukti kegagalan.
- Jangan memakai perubahan logika model untuk mengarang narasi kerja. Label publik dibangun dari aktivitas terbukti.

## Keputusan untuk dataset
Masalah awal adalah router-trace bocor ke percakapan, bukan kekurangan JSON. Solusi adalah **kontrak presentasi terpisah** antara log observabilitas dan narasi user-facing, dengan model preface yang hanya boleh mengungkap rencana publik yang memang sah, tidak hidden reasoning. Pengujian UX (bukan sekadar unit test) menjadi gate sebelum status "selesai".
