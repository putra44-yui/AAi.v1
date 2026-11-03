# AAi — Kerangka Kerja Dua Mode (Chatbot + Pendamping Android)

**Tanggal:** 3 November 2026  
**Status:** PLAN ONLY — belum membuat APK, animasi, atau overlay  
**Repository:** putra44-yui/AAi.v1  
**Branch kerja produk:** design/aai-crystal-refresh  
**Prinsip produk:** SATU AAi, SATU backend, SATU data akun/sesi/riwayat, DUA antarmuka; tidak perlu repo baru.

> **Maksud pengguna:** AAi adalah maskot asli yang terasa hidup, transparan, dan dapat bergerak bebas di layar Android. Balon komik mengikuti AAi dan memperlihatkan jawaban satu halaman tiap kali, dengan panah < dan > di sisi teks. Pesan dan input pengguna berada **terpisah di bawah layar**, tampil atau sembunyi melalui pengaturan. Mode Chatbot konvensional tetap ada dan lengkap. **Maskot AAi tidak boleh salah.**

## 0. Keputusan yang DIKUNCI

1. **Mode Chatbot:** pertahankan pengalaman AAi yang aktif sekarang — percakapan lengkap, teks panjang, Markdown, tabel, kode, sumber, unggahan gambar, sesi, dan riwayat.
2. **Mode Pendamping (AAi Companion):** maskot transparan tanpa kotak aplikasi, bisa digeser ke posisi aman mana pun di layar, termasuk atas aplikasi Android lain **setelah izin pengguna**. Ini bukan Android Picture-in-Picture video dan bukan panel chat yang mengikuti karakter.
3. **AAi, balon jawaban, dan chat bawah adalah komponen terpisah.** Posisi AAi bebas; balon mengikuti kepala; area input/preview pesan pengguna tetap melekat di bawah.
4. Chat pengguna di bawah punya setting **tampil/sembunyi**. Saat disembunyikan, karakter tetap hidup dan input dapat dipanggil kembali lewat tap AAi. Jangan membuat pengguna kehilangan cara mengetik.
5. **Satu balon komik saja** untuk status/jawaban AAi. Bila jawaban panjang, isi di dalam balon tersebut diganti per halaman menggunakan tombol panah kiri/kanan, bukan membuat balon baru atau deretan kartu.
6. Navigasi dalam balon menyerupai **< Masalahnya bukan tools. >** lalu **< Riwayat itu ada, tapi tersimpan di sesi lain. >**. Panah itu **kontrol navigasi**, bukan bagian kalimat, judul, atau sapaan otomatis. Jangan membuat header "< hai teguh >".
7. Status proses dapat tampil sementara di balon yang sama, misalnya **"Aku cek dulu, ya."**, dan **digantikan** saat jawaban tiba. Status harus sesuai event kerja nyata, tidak boleh mengarang "ketemu" atau "sudah cari".
8. Default page navigation **manual**; tidak meloncat otomatis saat user sedang membaca. Halaman terakhir/pertama menonaktifkan tombol yang tak bisa digunakan.
9. Pindah Chatbot ↔ Pendamping **tidak memulai sesi baru, tidak mengirim prompt dua kali, dan tidak menghilangkan riwayat atau bukti tool**.
10. Arah ini adalah lapisan pengalaman UI. Jangan mengganti model, menambah agent, mengubah korpus Benih AAi, atau memindahkan runtime kembali ke Next.js tanpa keputusan terpisah.

## 1. IDENTITAS MASKOT AAi — GATE WAJIB

**Sumber kanonis telah diperiksa dari repo, bukan gambar generik:**

| Fungsi | Aset dan bukti | Ketentuan |
| --- | --- | --- |
| **Maskot produksi AAi** | public/aai-mascot-studio.png — Git blob SHA **03ecbf99299936270dfdd465ade49e84500fe777** | Satu-satunya referensi sumber turunan untuk Pendamping |
| Penggunaan aktif | public/assets/js/app.js, public/index.html, public/login.html | Ketiganya mereferensikan aai-mascot-studio.png |
| Ciri dari deskripsi aplikasi | public/login.html: maskot berambut **putih** dan **kristal bertuliskan AAi** | **Teks AAi pada kristal wajib dipertahankan** |
| Aset lain | public/aai-crystal.png — blob d49450c07a31eed2d7d78b7754f132a01e73c500; public/aai-mascot.jpg | Jangan otomatis mengganti maskot dengan aset ini atau JPG lama |

**Larangan keras:** tidak mengambil karakter anime/chibi generik dari internet, tidak menggambar ulang dengan wajah, palet, atau atribut berbeda, tidak mengganti kristal, dan tidak menghapus tulisan **AAi**. Tidak memakai foto anak/pengguna sebagai maskot.

**Pekerjaan visual F0 yang belum dikerjakan:** periksa byte PNG, dimensi, channel alpha, area latar yang mungkin masih terbakar ke gambar, ruang transparan, dan keterbacaan kristal secara **visual** pada ukuran overlay. Keberadaan ekstensi PNG bukan bukti latar transparan. Dokumentasi sumber file dan alt HTML **bukan** pemeriksaan pixel-level.

Jika latar belum transparan, buat **salinan turunan** dari sumber produksi dan lakukan background removal **tanpa mengubah rambut, wajah, ornamen, kristal, atau huruf AAi**. File sumber jangan ditimpa. Setiap frame animasi harus lulus pembandingan visual dengan maskot kanonis. Simpan manifest turunan yang mencatat hash sumber, ukuran sprite, pivot kepala dan titik sentuh.

**Gate pengerjaan:** jika hasil potong latar/sprite membuat identitas AAi berubah atau tulisannya hilang, **stop pekerjaan animasi/overlay** sampai aset dikoreksi. Kecantikan karakter lain bukan substitusi identitas.

## 2. Kontrak UX — contoh yang benar

**Input pengguna** (bagian bawah layar, pesan dapat diatur terlihat/tidak):

> Jadi apa penyebabnya?

**AAi** (maskot bergerak bebas, satu balon mengikuti kepalanya):

- Saat benar-benar memproses: **Aku cek dulu, ya.**
- Balon yang sama menjadi page 1: **< Masalahnya bukan tools. >**
- Ketika user menekan >, isi balon berubah menjadi page 2: **< Riwayat itu ada, tapi tersimpan di sesi lain. >**
- Tekan < mengembalikan halaman sebelumnya.
- Jika pengguna menyeret AAi, balon ikut bergerak; **chat bawah tetap di tempat**.

**Yang TIDAK BOLEH terjadi:** satu kotak balon untuk tiap halaman; panel diskusi besar ikut AAi; label greeting selalu ditampilkan; isi lengkap hilang karena ringkasan otomatis; balon bertambah tinggi tanpa batas; halaman pindah sendiri sebelum selesai dibaca; karakter menghalangi tombol aplikasi lain.

### 2.1 Status antarmuka

| State | Perilaku |
| --- | --- |
| OFF | Overlay tidak aktif. Chatbot biasa tetap berfungsi |
| IDLE | Maskot tampil, gerak ringan, balon boleh tersembunyi |
| INPUT | Ketuk AAi untuk membuka composer di bawah; tetap dapat drag karakter |
| THINKING | Jika server melaporkan proses, balon status pendek dan ekspresi berpikir |
| STREAMING | Balon pertama mulai terisi; jangan memindahkan page yang sedang dibaca karena token baru |
| READING | Halaman siap, kontrol < > manual; ketuk baca penuh membuka Chatbot |
| ERROR/OFFLINE | Balon jujur tentang kegagalan dengan opsi coba lagi/buka Chatbot |
| SLEEP/PAUSED | Minim animasi saat layar terkunci/idle/hemat baterai |

### 2.2 Pengaturan pengguna

- Mode awal: Chatbot / Pendamping (perangkat lokal; tetap gunakan akun yang sama).
- Tampilkan/sembunyikan preview pesan pengguna di bawah.
- Tampilkan/sembunyikan composer bawah; bila OFF, tap AAi memunculkannya sementara.
- Ukuran karakter; posisi bebas; kunci posisi; reset posisi.
- Ukuran font balon, reduced motion, mode hemat baterai, tombol matikan overlay.
- Opsi balon status saat proses; **auto page** tidak diaktifkan pada MVP.

## 3. Pagination balon komik — aturan implementasi

1. **Simpan teks jawaban lengkap** sebagai konten kanonis di histori sesi. Page hanya representasi tampilan yang boleh dihitung ulang.
2. Pecah halaman berdasarkan batas **ukuran visual balon + kalimat/paragraf**, bukan potong buta setiap N karakter. Hormati grapheme/emoji, link, format Markdown, dan pemisahan kalimat.
3. Pembaca tetap berada di halaman yang sedang dipilih saat token streaming selanjutnya datang. Tawarkan halaman berikutnya setelah cukup data, jangan menggeser isi yang sedang dibaca.
4. Navigasi < / > berada **di sisi konten balon yang sama**, bukan di luar balon, bukan menggulir seluruh chat. Opsional indikator kecil 1/3, tidak wajib.
5. Di ujung layar, balon flip ke samping/bawah atau clamp ke safe area; titik ekor tetap mengarah ke kepala maskot.
6. Keyboard muncul? Chat bawah dan balon menghindari IME/cutout/nav bar; jangan diam-diam memindah page.
7. Tabel, kode panjang, gambar/berkas, dan dokumen kompleks dapat memiliki **"Buka lengkap di Chatbot"**. Jangan menghapus atau merasterkan informasi penting menjadi teks singkat.
8. Panah harus mudah ditekan (~48dp), punya accessibility label untuk TalkBack, dan berfungsi dengan font besar. Status animasi tidak boleh menutupi teks.
9. Tidak membuat ringkasan LLM baru khusus balon tanpa izin/biaya terukur. Jawaban sumber tetap satu dari backend yang sama.

## 4. Struktur teknis: kondisi repo AKTUAL

**Telah diperiksa:**

- Jalur produksi adalah **web statis di public/** dan **Cloudflare Worker** (src/worker.ts, src/chat.ts), bukan React/Next aktif. Jangan membongkar UI aktif hanya karena prototype.
- Repo sudah berisi Capacitor Android **8.3.x** (package.json), android/, dan MainActivity.java berbasis BridgeActivity. **Tidak perlu membuat repository Android baru.**
- AndroidManifest.xml sekarang hanya memiliki izin INTERNET; belum ada komponen overlay.
- **PERHATIAN:** capacitor.config.json masih menunjuk ke **https://a-ai-rust.vercel.app** (alamat lama). Audit endpoint dan desain packaging sebelum membangun APK. Target Worker aktif adalah **https://aai-v0.aai-agents-yuiputra44.workers.dev/**.
- UI produksi sekarang memakai aset maskot yang dikunci di atas.

**Arsitektur kandidat (belum diwujudkan):**

1. **Chatbot UI** tetap melalui aset web/Capacitor WebView dan backend yang sekarang.
2. **CompanionController** di Android (modul Kotlin/Java hasil keputusan audit) mengatur overlay transparan maskot dan balon, gesture, status, keyboard, izin, dan siklus hidup.
3. **CharacterOverlay** untuk karakter, transparan, bisa drag; **SpeechBubbleOverlay** mengikuti pivot kepala dengan ukuran terbatas.
4. **BottomComposerOverlay** adalah komponen terpisah berlabuh di bawah layar, dapat ditutup sendiri. Implementasi final native view atau WebView terbatas dipilih berdasarkan hasil uji IME dan permission Android.
5. **ConversationAdapter** berbagi satu session_id dan satu sumber event SSE/API. Mode Chatbot dan Pendamping tidak boleh membuka dua streaming request untuk prompt yang sama.
6. **Web demo** boleh mensimulasikan pengalaman Pendamping **di dalam AAi** untuk validasi interaksi; PWA/website tidak bisa menampilkan karakter di atas aplikasi Android lain. Untuk itu butuh overlay native.

**Android:** WindowManager TYPE_APPLICATION_OVERLAY, window dengan alpha (PixelFormat.TRANSLUCENT), izin SYSTEM_ALERT_WINDOW dan permission settings saat diminta pengguna. Gunakan komponen sentuh yang berbatas; jangan membuat overlay transparan layar penuh yang menghalangi input aplikasi lain. Foreground service + notifikasi hanya jika diperlukan dan sesuai aturan versi Android. Jangan paksa auto-start tanpa persetujuan.

**Dokumentasi platform untuk implementasi:**
- https://developer.android.com/reference/android/view/WindowManager.LayoutParams#TYPE_APPLICATION_OVERLAY
- https://developer.android.com/develop/ui/views/picture-in-picture
- https://developer.android.com/develop/background-work/services/fgs/changes
- https://developer.android.com/develop/ui/views/notifications/bubbles

## 5. Privasi, keamanan, dan kontrol OS

- **Jangan membaca isi layar aplikasi lain** secara otomatis. Tidak ada AccessibilityService, tangkapan layar diam-diam, perekaman layar, atau penangkapan sentuhan di luar komponen AAi. Share intent teks/gambar hanya lewat tindakan sadar pengguna.
- Jika izin overlay ditolak/dicabut, gunakan Chatbot atau mode Pendamping **di dalam aplikasi saja**; jangan memaksa perizinan berulang.
- Tidak ada Supabase service-role, OpenRouter key, atau token server yang ditaruh di APK; semuanya tetap di Worker.
- **Gate sebelum APK keluarga digunakan untuk data pribadi:** login produksi masih username-only. Autentikasi global dan otorisasi semua endpoint harus selesai, dengan bukti akun A tidak dapat melihat sesi akun B. PR #8 terkait Auth dan PR #12 tool pencarian antar-sesi adalah pekerjaan terpisah yang belum boleh dianggap selesai/aktif.
- Pertimbangkan teks balon yang bisa terlihat oleh orang lain saat membuka aplikasi sensitif. Jangan memunculkan percakapan sensitif di lock screen atau mengirim isinya ke analytics/log publik.
- Overlay dan service harus bisa dihentikan mudah; test Android 12–16 / berbagai vendor tanpa klaim pasti kompatibel sebelum diuji.
- Repository saat audit **PUBLIC**. MD hanya memuat arsitektur dan contoh sintetis; jangan commit kata sandi, cookie, screenshot sesi keluarga, atau data pribadi.

## 6. Tahap pelaksanaan dan gate

| Tahap | Pekerjaan | Bukti lulus |
| --- | --- | --- |
| **F0 — Baseline & Maskot** | Audit asset kanonis secara visual dan alpha; audit sumber UI, Capacitor config, Android build, alur SSE | Maskot sama persis, huruf AAi utuh, source hash tercatat, masalah config terinventaris |
| **F1 — Prototipe tampilan** | Pilihan mode Chatbot/Pendamping di UI; karakter draggable; satu balon berpage; chat bawah opsional di dalam aplikasi | UX sesuai contoh pengguna; Chatbot lama tidak rusak; belum mengklaim overlay |
| **F2 — Integrasi satu sesi** | Adapter status/streaming, pelestarian jawaban utuh, page stability, pergantian mode | Satu pesan satu respons, ID sesi konsisten, tidak ada duplicate send |
| **F3 — Native Android** | Character + bubble overlays, bottom composer independen, izin OS, IME, insets, notifikasi/fallback | APK debug terbukti berfungsi di atas aplikasi lain tanpa menyadap sentuhan |
| **F4 — Security & stabilitas** | Supabase Auth, uji akun A/B, hidup/mati overlay, baterai, crash, performa | Tak ada akses silang, izin dapat dicabut, baterai terukur |
| **F5 — Uji perangkat & rilis** | Android 12–16, font besar, mode hemat, rotasi, keyboard, aksesibilitas, regression suite | QA nyata PASS dan keputusan rilis berdasarkan bukti |

**Urutan wajib:** F0 → F1 → F2 → F3 → F4 → F5. Boleh mengerjakan Auth sebagai jalur paralel, tapi **tidak melewati gate keamanan untuk rilis**.

## 7. Matriks tes minimum

1. **Maskot:** pixel/alpha/pose benar; rambut putih; kristal dengan tulisan AAi; transparansi diuji pada latar terang, gelap, dan aplikasi lain; asset turunan tidak mengubah identitas.
2. **Balon:** hanya satu; status berganti ke jawaban; < / > mengubah isi halaman dalam balon yang sama; tombol ujung nonaktif; teks tidak hilang.
3. **Streaming:** halaman yang dibaca tidak berubah sendiri; kesalahan server jujur; tidak mengulang permintaan, tidak menciptakan status tool palsu.
4. **Chat bawah:** pesan user tampil/sembunyi; composer tetap di bawah; keyboard dan rotasi tidak membuat character overlay berpindah kacau.
5. **Drag:** pindah ke tepi atas/bawah/kiri/kanan; balon tidak keluar viewport; tombol di aplikasi lain dapat digunakan.
6. **Konten:** >10 halaman; emoji; Markdown; tautan; kode dan tabel menuju Chatbot tanpa kehilangan jawaban.
7. **Sinkronisasi:** Chatbot ↔ Pendamping menggunakan sesi sama, history sama, branch chat sama; copy dan regenerasi tetap tersedia dalam Chatbot.
8. **Keamanan:** akun A/B, overlay permission, lock screen, tidak ada konten pribadi yang dilog, tidak ada key di APK.
9. **Kinerja:** profil CPU, FPS, RAM, baterai idle dan streaming pada perangkat nyata; target angka baru ditentukan setelah baseline.
10. **Regression:** seluruh tes existing dan Cloudflare build hijau; APK diuji dengan akun dummy.

## 8. Yang BELUM disetujui atau di luar MVP

- Mengganti desain maskot; menghapus kristal/tulisan AAi; karakter generik.
- Live2D/3D kompleks, voice aktif sepanjang hari, lip sync penuh, animasi berat, selalu menyala saat boot.
- Auto-page yang menghilangkan kontrol pembaca, balon panjang tak terbatas, fitur menyadap aplikasi lain.
- Mengubah model atau tool policy, menambah database kedua, mengaktifkan PR #12 tanpa Auth.
- Migrasi Next/React baru, backend baru, atau repository baru.
- Mengklaim PNG sudah transparan/Android sudah berhasil build/live hanya karena perencanaan selesai.

## 9. Format laporan setiap fase untuk audit dan dataset AAi

Setiap fase wajib mencatat **(a)** gejala/tujuan pengguna, **(b)** baseline file dan commit, **(c)** opsi dan trade-off, **(d)** perubahan nyata, **(e)** tes otomatis dan perangkat nyata, **(f)** kegagalan/batas yang tersisa, **(g)** keputusan fase berikutnya. Gunakan contoh sintetis. Jangan mengubah hipotesis menjadi fakta atau menjanjikan fitur yang belum dijalankan.

## 10. Checkpoint 3 November 2026

**Sudah:** kesepakatan dua mode dan interaksi balon komik; identifikasi maskot produksi, path dan hash; konfirmasi Android/Capacitor sudah ada; catatan konfigurasi Vercel lama; kerangka kerja ini.

**Belum:** inspeksi visual/pixel PNG, turunan transparan, komponen mode Pendamping, Android overlay, build APK, uji lintas perangkat, perbaikan Auth. Semua itu adalah pekerjaan fase berikutnya, **bukan hasil yang telah dicapai**.

**Langkah pertama nanti:** F0 — **pastikan aset maskot benar secara visual**, terutama rambut putih, kristal, dan tulisan **AAi**, baru membuat sprite/animasi apa pun.
