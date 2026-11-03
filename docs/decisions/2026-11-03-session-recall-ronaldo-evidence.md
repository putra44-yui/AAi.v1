# ADR: AAi mengingat obrolan Ronaldo dengan bukti sesi, bukan klaim memori kosong
Tanggal: 2026-11-03
Branch: fix/aai-recent-conversation-recall-20261103
Status: kandidat perbaikan, terpisah dari PR #8 autentikasi

## Bukti kegagalan
Pengguna menunjukkan screenshot: "Kita habis bicara tentang Ronaldo, coba ingat ingat lagi." AAi menjawab "hasilnya tetap kosong" dan "nggak ada satu pun serpihan soal Ronaldo di memori yang bisa aku baca," lalu berspekulasi pengguna sengaja menguji model. Jawaban itu menyamakan *memori jangka panjang* dengan *riwayat percakapan*, lalu menarik kesimpulan terlalu luas dari pencarian terbatas.

## Root cause terverifikasi di kode
- `prepareSession` memuat sampai **80 pesan terbaru** pada sesi yang sedang dibuka dan telah memeriksa pemilik sesi.
- `buildSessionContext` hanya mengikuti **16 pesan terakhir pada cabang aktif**. Topic lebih lama bisa tak ikut dikirim ke model.
- `loadAAiContext` memilih sampai **14 catatan person_memory** dan bukan arsip semua chat.
- Jika 16 pesan terakhir dan pilihan memori tidak menyebut topik, model dapat menyimpulkan "memori kosong" tanpa memeriksa sisa 80 pesan yang sebenarnya sudah diambil.
- Belum tersedia pencarian memori lintas sesi yang aman: autentikasi produksi masih username-only; PR #8 terpisah dan belum boleh diaktifkan tanpa pengaitan akun.

## Keputusan desain
- Tambah `src/aai-session-recall.ts`: bila permintaan mengingat terdeteksi, telusuri **hanya pesan pada cabang aktif dari maksimum 80 pesan yang sudah dimuat**. Jangan query tabel lain, jangan baca sesi lain, jangan bocorkan cabang edit/sibling.
- Pilih paling banyak 4 petikan yang memiliki kecocokan kata topik, potong panjang tiap petikan, dan sertakan sebagai *evidence* data, bukan instruksi. Jika tidak ada kata topik, jangan mengirim petikan acak.
- Tampilkan dialog aktivitas "Aku cek obrolan di sesi ini" hanya bila pemeriksaan benar dilakukan; jangan menampilkan hitung memori router.
- Saat evidence ditemukan, pakai untuk menjawab substansi. Bila tidak ditemukan, nyatakan hanya "**belum ditemukan dalam bagian obrolan yang tersedia**". Jangan mengklaim database seluruhnya kosong atau obrolan itu tak pernah terjadi. Jangan membuat spekulasi tentang niat pengguna.
- Konteks asli pesan terbaru tetap jadi sumber utama, dan bukti percakapan bukan memori permanen.
- Jangan mengubah struktur DB, tetap hindari pencarian lintas sesi sampai autentikasi terverifikasi. Ini *perbaikan dalam konteks yang sudah diakses*, bukan aktivasi fitur recall PR #8.

## Tes
- 26 pesan berantai: topik "Ronaldo/BOAT" dalam bagian yang lebih lama dari 16 pesan harus ditemukan.
- Pesan sibling di cabang edit tidak boleh ditemukan.
- Topik yang tidak ada harus menghasilkan batasan yang tepat; tidak mengklaim memori global kosong.
- Percakapan biasa tidak memicu recall.
- Jumlah petikan dan panjang masing-masing dibatasi.
- Integrasi server menyisipkan petikan ke payload model dan event publik `recall`; tes dan build harus hijau.
- Uji langsung pada percakapan keluarga sebaiknya dilakukan setelah login terverifikasi. Jangan mencetak atau mengutip isi riwayat pribadi sebagai fixture.

## Batas
- Jika topik Ronaldo terjadi dalam sesi lain, atau lebih lama dari 80 pesan yang dimuat, fitur ini belum menemukannya. AAi harus jujur akan batas itu.
- Keamanan autentikasi saat ini belum terselesaikan; jangan menjanjikan penelusuran total riwayat keluarga.
