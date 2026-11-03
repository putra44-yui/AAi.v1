# AAi v0 — Private search_chat_history Tool (opsi B)
Tanggal: 2026-11-03
Status: STAGED / DISABLED sampai akun Supabase Auth ditautkan.
Branch: feat/aai-private-history-tool-20261103
Basis: design/aai-crystal-refresh

## Masalah
AAi dapat menampilkan sesi lama, tetapi model tidak punya tool pencarian antar-sesi. PR #11 hanya mencari dalam 80 pesan dari sesi aktif; pembicaraan Ronaldo ada di sesi lain.

## Kontrak fitur
- Tool bernama search_chat_history. Model hanya memberikan parameter query (3–160 karakter), tidak dapat menentukan user_id, ID sesi, limit, atau query SQL.
- Supabase Auth getUser(token) di server memverifikasi cookie __Host-aai_access, lalu user_id dari app_metadata.aai_user_id (milik admin) wajib sama dengan user_id request. Periksa origin POST. Jangan mempercayai user_metadata.
- Fail closed: tool hanya ditawarkan bila AAI_AUTH_REQUIRED=true DAN AAI_CROSS_SESSION_RECALL_ENABLED=true DAN verifikasi JWT berhasil.
- Pemanggilan model sekali dengan tool_choice required; tidak dibaurkan dengan Tavily/Exa.
- Backend mencari maksimum 10 sesi terbaru (kecuali sesi aktif) dari tabel sessions memakai eq(user_id, verifiedOwner), kemudian maksimum 300 pesan dari ID sesi yang terbukti milik akun itu.
- Pilih paling banyak empat kutipan yang mengandung subjek, 420 karakter per kutipan; sertakan judul dan tanggal ringkas.
- Hasil dikirim ke model sebagai tool result, bukan log publik. Kutipan merupakan data tidak tepercaya, bukan instruksi.
- Dialog publik terjadi hanya setelah aksi nyata: “Aku menelusuri obrolan kita yang lain...” dan “Nah, ada bagian obrolan yang cocok...”. Jika gagal/nihil, laporkan batas pencarian yang benar.
- Web search dinonaktifkan untuk intent recall, bahkan jika izin web ON. Konten chat pribadi tidak dikirim ke Tavily/Exa.
- Tidak membuat tabel baru, tidak menambah memori otomatis, tidak mengubah corpus Benih AAi.

## Gerbang keamanan mutlak
Pada audit sebelumnya, 4 akun AAi masih login berbasis username, sementara belum ada akun Supabase Auth. Worker produksi masih menerima user_id dari browser. Meskipun tool mempunyai cek token sendiri, API lain tetap rentan IDOR.

JANGAN merge/deploy fitur ini sampai:
1. Administrator mendaftarkan empat akun Supabase Auth dengan email/password masing-masing via kanal privat.
2. Administrator memetakan akun Auth ke legacy user ID melalui app_metadata setelah verifikasi orang yang benar.
3. PR #8 atau setara memperkuat seluruh API Worker terhadap user_id palsu.
4. Bukti tes A tidak dapat membaca sesi B, forged cookie/expired JWT/CSRF ditolak, dan isi hasil tool tidak bocor ke log/web.
5. Nyalakan AAI_AUTH_REQUIRED terlebih dahulu; baru AAI_CROSS_SESSION_RECALL_ENABLED. Rollback harus mematikan fitur recall saja, bukan mengembalikan username-only tanpa peringatan risiko.

## Batas dan trade-off
- Cakupan 10 sesi terbaru, bukan keseluruhan hidup/riwayat. Batas 300 pesan keseluruhan dapat mengecualikan pesan lama.
- Pencocokan leksikal sederhana, bukan semantik/RAG.
- Empat petikan pribadi diberikan kepada model OpenRouter hanya setelah permintaan pengguna; jelaskan bahwa data ini dikirim ke penyedia model.
- Tes unit dan mocked DB tidak membuktikan tool berhasil pada provider hidup atau UX HP; uji setelah enrollment.
- Saat tool tidak ada, AAi harus jujur: belum bisa mencari sesi lain, bukan menyimpulkan pembicaraan tidak pernah terjadi.

## Acceptance
- Tool schema hanya query, bukan owner.
- Validasi app_metadata, bukan user_metadata; flag default OFF.
- DB query membatasi sessions owner dan messages session_id dari owner.
- Prompt Ronaldo memicu tool, permintaan menyimpan “ingat ini” tidak memicu.
- Maksimal 4 kutipan; log publik tidak memuat isi riwayat.
- CI unit, build, dan Wrangler dry-run.
- PR draft hingga auth siap; dokumentasikan alasan untuk dataset.
