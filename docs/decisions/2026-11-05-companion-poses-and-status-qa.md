# AAi Pendamping — QA gerak dan status percakapan (5 November 2026)

## Masalah yang dibuktikan
- Pengguna bertanya "kamu siapa?"; Pendamping menampilkan status "Aku cek dulu, ya" meskipun belum ada request pencarian atau aktivitas yang memerlukan pemeriksaan.
- Status itu di-hardcode pada event `begin` dan `reset` di `public/assets/js/aai-companion.js`, bukan berasal dari model maupun tool.
- Prompt identitas dasar di `src/aai-context.ts` telah menyatakan "Kamu adalah AAi" dan melarang pengakuan sebagai ChatGPT. Jawaban model yang menyebut ChatGPT tidak disebabkan oleh prompt baru APK. Preview masih meneruskan `/api/chat` ke Worker produksi.
- Render animasi pertama memakai satu PNG berdiri; rotasi tubuh pada pose tidur ~-0,9 radian membuatnya terlihat seperti foto dimiringkan, walau sebagian polygon terpotong untuk gerakan.

## Perubahan uji
1. Jangan tampilkan teks pemeriksaan pada awal streaming. Biarkan animasi "berpikir" berjalan, tetapi balon kata hanya muncul ketika ada preface/progress sungguhan dari backend atau token jawaban.
2. Tiga key pose ilustrasi terpisah dibuat dengan acuan satu master `public/aai-mascot-studio.png`: `sleep` (mata tertutup, tangan menempel di pipi, meringkuk), `think` (jari ke dagu), `talk` (siku menekuk, gestur tangan). Semua tetap menampilkan kristal dada berlabel `AAi`; master tidak diubah. Asli PNG resolusi penuh disimpan sebagai bahan internal, WebP transparan ukuran 820×852 dipakai untuk hemat data.
3. Canvas renderer mempertahankan rig cutout untuk rambut, pita, rok, dan tangan ketika berbicara. Transisi bangun memadukan pose tidur ke gambar berdiri tanpa memiringkan seluruh tubuh. Pose sentuhan dan terbang memakai rig master sementara.
4. Tambah `/aai-motion-lab.html` pada cabang QA saja sebagai penguji visual tanpa login, sesi, pesan, atau akses backend.
5. Update tes regresi: periksa berkas WebP, pemetaan state, dan larangan status awal palsu.

## Batas kualitas dan risiko
- Ini prototipe cutout+key-pose 2D, bukan rig Live2D/Spine berbobot deformasi; belum terbukti natural pada semua ponsel. Pose dibuat generatif dengan mengunci wajah/warna/kristal, tetapi konsistensi per piksel tidak identik dengan master.
- Pose yang belum memiliki key art asli (shy, happy, fly) masih memakai master dan artikulasi terbatas. Jangan klaim tahap "animasi final".
- Chat backend produksi tidak disentuh oleh PR ini. Klaim identitas model yang menyebut ChatGPT perlu dilacak memakai contoh keluaran lengkap, tanpa mengubah pesan yang tersimpan.
- Ketika QC puas barulah pertimbangkan APK baru. Kode ini tetap di branch PR draft, tidak otomatis digabungkan ke produksi.
