# AAi — Kerangka Kerja Dua Mode (Chatbot + Pendamping Android)

**Tanggal:** 3 November 2026  
**Status:** F1 prototipe animasi pixel-part di cabang fitur; APK baru tidak dibuat. Uji visual HP masih diperlukan.  
**Revisi:** 3 November 2026 — identitas maskot, gesture, modesty response, micro-LLM, dan larangan memakai APK Vercel/Next lawas sebagai acuan  
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
10. Arah ini adalah lapisan pengalaman UI. Jangan mengganti model utama, menambah agent rapat, mengubah korpus Benih AAi, atau memindahkan runtime kembali ke Next.js tanpa keputusan terpisah.
11. **Interaksi sentuh karakter** memicu ekspresi sopan dengan animasi sangat cepat. Kalimat respons dapat bervariasi memakai model ringan **non-reasoning** melalui backend; tidak menjalankan pipeline reasoning, tools, atau pencarian web.
12. **Animasi lembut dan natural** adalah kriteria kualitas, bukan sekadar dekorasi. Saat sentuhan di kepala atau zona pribadi maskot, responsnya malu/menjaga batas, bukan konten erotis.
13. **APK/website Vercel + Next yang lama adalah arsip eksperimen pemilik, BUKAN rujukan desain atau arsitektur.** Pertahankan hanya informasi yang memang berguna secara eksplisit dan telah diaudit; jangan copy UI lawas.

## 1. IDENTITAS MASKOT AAi — GATE WAJIB

**Sumber kanonis telah diperiksa dari repo, bukan gambar generik:**

| Fungsi | Aset dan bukti | Ketentuan |
| --- | --- | --- |
| **Maskot produksi AAi** | public/aai-mascot-studio.png — Git blob SHA **03ecbf99299936270dfdd465ade49e84500fe777** | Satu-satunya referensi sumber turunan untuk Pendamping |
| Penggunaan aktif | public/assets/js/app.js, public/index.html, public/login.html | Ketiganya mereferensikan aai-mascot-studio.png |
| Ciri dari deskripsi aplikasi | public/login.html: maskot berambut **putih** dan **kristal bertuliskan AAi** | **Teks AAi pada kristal wajib dipertahankan** |
| Aset lain | public/aai-crystal.png — blob d49450c07a31eed2d7d78b7754f132a01e73c500; public/aai-mascot.jpg | Jangan otomatis mengganti maskot dengan aset ini atau JPG lama |

**Larangan keras:** tidak mengambil karakter anime/chibi generik dari internet, tidak menggambar ulang dengan wajah, palet, atau atribut berbeda, tidak mengganti kristal, dan tidak menghapus tulisan **AAi**. Tidak memakai foto anak/pengguna sebagai maskot.

**Audit visual F0 — terverifikasi sebagian (3 November 2026):** gambar kanonis telah diekstrak dari APK debug yang dibangun GitHub Actions, **1230 × 1278 px, RGBA, alpha minimum 0 dan maksimum 255, keempat sudut transparan**, dengan rambut putih serta kristal bertuliskan **AAi** terlihat pada hasil inspeksi. Git blob SHA telah dicocokkan secara independen dan dikunci pada tes. **Belum lulus:** evaluasi tangan/pose menutupi kepala dan area pribadi, pengujian visual di beberapa HP nyata, serta frame animasi terpisah. Jangan mengklaim pose tangan sudah ada hanya karena sprite sekarang bisa digerakkan.

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

### 2.3 Personality & Touch Interaction — aturan maskot

**Tujuan:** membuat AAi terasa hidup, hangat, pemalu secukupnya, punya batas, dan kadang usil. Ia **tidak** berubah menjadi karakter lain, tidak genit atau erotis, tidak agresif, dan tidak memarahi pengguna dengan bahasa moralistik. Contoh yang disetujui pengguna: "Duh… jangan dipegang, malu." atau variasi natural seperti "Ih, jangan pegang kepala sembarangan… rambutku jadi berantakan."

**Zona interaksi awal (hitbox transparan mengikuti sprite, bukan membaca layar HP):**

| Gesture/area | Reaksi visual instan | Reaksi verbal (contoh, bukan template wajib) |
| --- | --- | --- |
| Tap netral pada karakter | Noleh, kedip, senyum kecil | "Hmm? Ada apa?" / "Heii, kaget aku." |
| Tap kepala/rambut | Refleks tangan **menutup atau merapikan kepala**, sedikit menunduk | "Duh… kepala juga jangan sembarang dipegang, malu." |
| Tap bagian pribadi/area sensitif sprite | Tangan **menutupi bagian tubuh yang relevan**, sedikit berputar atau mundur; tetap sopan | "Ih, jangan begitu dong… malu, tau." / "Heii, jaga tangan… bukan mahram." |
| Tap berulang yang mengganggu | Ekspresi makin tegas tanpa eskalasi fisik berlebihan | "Dari tadi usil terus, ya?" |
| Drag/geser | Gerak mengikuti jari, ekspresi singkat tanpa berulang-ulang bicara | "Pelan-pelan, dong." (opsional) |
| Long-press | Tampilkan menu setting/kunci posisi/sembunyikan, **bukan** event sentuhan pribadi | Tidak wajib mengucapkan apa pun |
| Idle | Napas halus, kedip natural, micro-movement hemat baterai | **Default diam**; tidak menyapa tanpa diminta atau terus mengganggu |

**Batas etika dan UX:** reaksi adalah gesture sosial kartun yang sopan, bukan mengundang sentuhan berulang demi konten sugestif. Hindari framing erotis, ekspresi berlebihan, maupun detail tubuh eksplisit. "Bukan mahram" adalah **contoh gaya AAi** yang boleh dipakai sesuai pengaturan persona/konteks, **bukan** kalimat otomatis setiap tap. Hindari menyebut pengguna "nakal" dengan cara mempermalukan; respons cukup melindungi batas karakter dengan humor ringan.

**Pemisahan teknis:** tap dan drag memiliki makna berbeda. Gunakan threshold gerakan dan durasi sentuh agar gerakan memindahkan AAi tidak dianggap menyentuh kepala/badan. Hitbox area kepala dan pribadi harus mengikuti koordinat **maskot kanonis dan frame animasi aktual**; jangan membagi gambar menjadi tiga bidang horizontal sembarangan yang menyebabkan salah reaksi. Jika aset statis belum dapat dianotasi dengan aman, MVP hanya mendukung tap umum + drag dulu sampai peta zona lulus audit.

### 2.4 Animasi halus — identitas lebih penting dari efek

- Idle menggunakan napas tipis, kedip yang tidak periodik kaku, sedikit perubahan orientasi kepala, dan goyangan kristal/rambut **ringan** sesuai bentuk asli. Jangan menambahkan anggota tubuh, pakaian, atau ornamen yang berbeda dari karakter kanonis.
- Transisi gerakan **ease-in/ease-out** dan blend antarstate (IDLE, NOTICE, SHY_HEAD, SHY_PROTECT, THINKING, TALKING, SLEEP). Gerak tangan menutup kepala/bagian pribadi **hanya** dijalankan bila frame/sprite bisa dibuat tanpa mengubah identitas atau tulisan "AAi" pada kristal.
- Saat ditekan, animasi lokal bereaksi **segera** tanpa menunggu server atau model. Balon teks boleh menyusul ketika kalimat dihasilkan.
- Jangan membuat gerakan besar, bouncing tanpa henti, kilatan/flicker, atau animasi ramai yang menghalangi orang menggunakan HP. Gerakan tidak boleh merusak keterbacaan teks di balon.
- Animasi saat idle bisa dibatasi frame rate atau dijeda pada low-power, background/layar terkunci, reduced-motion dan ketika overlay tersembunyi. Tetapkan target CPU/FPS/baterai **sesudah** mengukur perangkat nyata; jangan mengklaim pasti ringan sejak dokumen rencana.
- Gunakan model transformasi/sprite 2D sederhana terlebih dahulu. Live2D/3D atau lip-sync hanya hipotesis tahap lanjut, tidak perlu untuk MVP.

### 2.5 Micro-Reaction Engine — cepat, bervariasi, tanpa reasoning panjang

**Keputusan revisi:** pengguna tidak ingin kumpulan respons statis yang terasa seperti template. Karena itu **LLM ringan tanpa reasoning panjang adalah kandidat utama untuk kalimat spontan**, sementara **animasi harus tetap deterministik/lokal dan langsung**. Dua bagian ini tidak boleh saling menunggu.

Alur yang disarankan:

1. Android mengidentifikasi event dan zona melalui gesture/hitbox lokal; trigger animasi instan tanpa HTTP request.
2. Modul Companion menyiapkan konteks minimal yang aman: jenis event (HEAD_TAP, PROTECTIVE_TAP, NORMAL_TAP, REPEATED_TAP, DRAG_END), state emosional ringan, dan **sedikit variasi kalimat terakhir** agar tidak berulang. Tidak mengirim koordinat layar, aplikasi lain yang terbuka, atau histori penuh.
3. Bila fitur respons dinamis ON, backend AAi memanggil **model ringan berlatensi rendah dengan reasoning dimatikan jika provider mendukung**, temperature/variasi terkendali dan output dibatasi satu kalimat singkat. **Bukan** model chat utama, bukan agent, bukan tool-calling, bukan pencarian web, bukan reasoning panjang, dan tidak memodifikasi sesi chat.
4. Jika hasil lolos validasi gaya, balon yang sama menampilkan satu respons natural; jika model terlambat/error/offline/terbatas kuota, pilih satu **fallback lokal dari kumpulan reaksi yang dikurasi** agar sentuhan tidak terasa macet.
5. Respons micro-reaction **tidak** otomatis masuk ke histori chat, memori permanen, data training, atau log sensitif. Jika pengguna memilih agar respons ini masuk ke riwayat, perlu desain dan persetujuan terpisah.

**Output contract micro-LLM:**
- Bahasa mengikuti pengaturan AAi; kalimat pendek, natural dan sopan, tidak menggunakan format panjang, markdown, pertanyaan kuis atau ceramah.
- Dilarang menambahkan klaim sudah mengakses layar, chat lama, kamera, memori, tools, atau data keluarga.
- Dilarang konten seksual eksplisit, penghinaan, narasi tubuh erotis, ajakan berulang menyentuh zona tertentu, atau kalimat yang terlalu intim di luar gaya yang dipilih pengguna.
- Validasi panjang, keselamatan, relevansi zona, dan teks duplikat; **retry maksimal terbatas**. Jika gagal pakai fallback yang aman.
- Anti-spam: debounce tap, cooldown per zona/ucapan, minimal jeda antar-request, pembatasan biaya, pembatalan request lama bila gesture baru datang; **jangan meluncurkan satu request untuk setiap tap cepat**.
- Percakapan nyata tetap memakai pipeline Chatbot/AAi penuh saat pengguna mengirim pertanyaan di composer, **jangan** mengalihkan semua chat ke micro-LLM.
- Konfigurasi model, mode tanpa reasoning, dan batas output harus mengikuti ketersediaan model API sebenarnya; lakukan pengukuran TTFT, biaya, dan kegagalan sebelum memilih model final. Tidak menjanjikan respons jaringan instan/0 ms.

**Pilihan praktis:** micro-LLM boleh dimatikan di Pengaturan (hemat data/baterai atau privat). Dalam mode offline/fallback, variasi memakai state, cooldown, dan penghindaran pengulangan; jujur bahwa sebagian kalimat lokal. Tidak membuat model berpura-pura punya reasoning internal.

### 2.6 Contoh walkthrough gesture (sintetis)

**Tap kepala:** AAi berkedip, sedikit menunduk dan mengangkat tangan melindungi/merapikan kepala; lalu satu balon mengucapkan, misalnya: "Duh… jangan dipegang, malu."

**Tap area pribadi:** AAi mundur kecil dan menutupi area terkait dengan gerakan non-vulgar; balon menampilkan respons singkat yang variatif, misalnya: "Ih, jangan begitu dong… malu, tau."

**Tap berulang:** tanpa memanggil LLM berkali-kali, AAi mengubah ekspresi menjadi tegas dan setelah cooldown dapat menjawab: "Heii, dari tadi usil terus."

**Drag:** maskot ikut bergerak; ketika dilepas dia settle dengan halus; input bawah dan halaman balon **tidak ikut terseret**. Drag tidak dianggap sentuhan pribadi.

**Saat pengguna mengetik pertanyaan:** balik ke alur **chat utama** satu sesi, bukan event micro-LLM; jawaban utama menggunakan halaman komik manual seperti yang disepakati.

**Penting:** ini contoh perilaku produk, **bukan perintah untuk menghasilkan aset baru sekarang**.

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
- **ARSIP LAWAS — JANGAN DITIRU:** capacitor.config.json masih menunjuk ke **https://a-ai-rust.vercel.app**, yaitu APK/prototipe lama buatan pemilik dengan Next.js. Pemilik menegaskan desain/arsitektur lamanya **bukan acuan dan tidak boleh dicopy**. Proyek Android yang ada boleh dijadikan titik audit Gradle/manifest saja, bukan referensi UI. Desain baru wajib berasal dari spesifikasi ini + web Cloudflare aktif. Target Worker aktif adalah **https://aai-v0.aai-agents-yuiputra44.workers.dev/**.
- UI produksi sekarang memakai aset maskot yang dikunci di atas.

**Arsitektur kandidat (belum diwujudkan):**

1. **Chatbot UI** tetap melalui aset web/Capacitor WebView dan backend yang sekarang.
2. **CompanionController** di Android (modul Kotlin/Java hasil keputusan audit) mengatur overlay transparan maskot dan balon, gesture, status, keyboard, izin, dan siklus hidup.
3. **CharacterOverlay** untuk karakter, transparan, bisa drag; **SpeechBubbleOverlay** mengikuti pivot kepala dengan ukuran terbatas.
4. **BottomComposerOverlay** adalah komponen terpisah berlabuh di bawah layar, dapat ditutup sendiri. Implementasi final native view atau WebView terbatas dipilih berdasarkan hasil uji IME dan permission Android.
5. **ConversationAdapter** berbagi satu session_id dan satu sumber event SSE/API. Mode Chatbot dan Pendamping tidak boleh membuka dua streaming request untuk prompt yang sama.
6. **Web demo** boleh mensimulasikan pengalaman Pendamping **di dalam AAi** untuk validasi interaksi; PWA/website tidak bisa menampilkan karakter di atas aplikasi Android lain. Untuk itu butuh overlay native.
7. **CompanionGestureEngine** menjalankan hit testing, debounce, cooldown dan animasi lokal tanpa panggilan jaringan. **CompanionMicroReplyGateway** (fitur opsional, server-only) menghasilkan kalimat singkat bervariasi melalui model ringan tanpa reasoning panjang; tidak terhubung ke riwayat percakapan Chatbot dan tidak mengakses tools. Seluruh secret tetap di Worker.

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
- **Micro-LLM:** semua panggilan dilakukan lewat backend AAi yang mengendalikan izin, kuota, validasi output dan anti-spam. Tidak menyimpan posisi tap, nama aplikasi lain, konten pribadi, atau rangkaian histori lengkap untuk prompt gesture.
- **Gate sebelum APK keluarga digunakan untuk data pribadi:** login produksi masih username-only. Autentikasi global dan otorisasi semua endpoint harus selesai, dengan bukti akun A tidak dapat melihat sesi akun B. PR #8 terkait Auth dan PR #12 tool pencarian antar-sesi adalah pekerjaan terpisah yang belum boleh dianggap selesai/aktif.
- Pertimbangkan teks balon yang bisa terlihat oleh orang lain saat membuka aplikasi sensitif. Jangan memunculkan percakapan sensitif di lock screen atau mengirim isinya ke analytics/log publik.
- Overlay dan service harus bisa dihentikan mudah; test Android 12–16 / berbagai vendor tanpa klaim pasti kompatibel sebelum diuji.
- Repository saat audit **PUBLIC**. MD hanya memuat arsitektur dan contoh sintetis; jangan commit kata sandi, cookie, screenshot sesi keluarga, atau data pribadi.

## 6. Tahap pelaksanaan dan gate

| Tahap | Pekerjaan | Bukti lulus |
| --- | --- | --- |
| **F0 — Baseline & Maskot** | Audit asset kanonis secara visual dan alpha; audit sumber UI, Capacitor config, Android build, alur SSE | Maskot sama persis, huruf AAi utuh, source hash tercatat, masalah config terinventaris |
| **F1 — Prototipe tampilan** | Pilihan mode Chatbot/Pendamping di UI; karakter draggable; satu balon berpage; chat bawah opsional; **gestur kepala/netral/pribadi sintetis + reaksi animasi sopan** | UX sesuai contoh pengguna; Chatbot lama tidak rusak; zona drag/tap tidak tertukar; belum mengklaim overlay |
| **F2 — Integrasi satu sesi** | Adapter status/streaming, pelestarian jawaban utuh, page stability, pergantian mode; **micro-reaction gateway opsional non-reasoning dan fallback lokal** | Satu pesan satu respons, ID sesi konsisten, tidak ada duplicate send; micro-LLM tidak menambah chat/memori atau tool web |
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
11. **Sentuhan:** zona kepala/area pribadi hanya aktif bila hitbox benar; respons menutup kepala/bagian terkait dengan sopan; tap biasa dan drag dibedakan; spam tap tidak menembakkan request berulang.
12. **Micro-LLM:** hasil bervariasi non-template tanpa reasoning/tools, output satu kalimat sesuai konteks, tidak mengarang memori; jika lambat/error/offline, animasi tetap instan dan fallback lokal dapat berfungsi; tidak menulis ke riwayat.
13. **Animasi:** cek gerak halus, transisi tanpa jitter, tulisan AAi tetap terlihat, reduced motion, state tidak macet saat rotate/IME/background.
14. **Legacy:** APK/web Vercel + Next lama tidak digunakan sebagai referensi visual dan bukan endpoint build baru.

## 8. Yang BELUM disetujui atau di luar MVP

- Mengganti desain maskot; menghapus kristal/tulisan AAi; karakter generik.
- Live2D/3D kompleks, voice aktif sepanjang hari, lip sync penuh, animasi berat, selalu menyala saat boot. **Animasi mikro yang halus, gesture sopan, dan balasan dinamis singkat justru masuk ruang lingkup prototipe.**
- Auto-page yang menghilangkan kontrol pembaca, balon panjang tak terbatas, fitur menyadap aplikasi lain.
- Mengubah model atau tool policy, menambah database kedua, mengaktifkan PR #12 tanpa Auth.
- Migrasi Next/React baru, backend baru, repository baru, atau menyalin ulang visual APK Vercel/Next lama.
- Mengklaim PNG sudah transparan/Android sudah berhasil build/live hanya karena perencanaan selesai.

## 9. Format laporan setiap fase untuk audit dan dataset AAi

Setiap fase wajib mencatat **(a)** gejala/tujuan pengguna, **(b)** baseline file dan commit, **(c)** opsi dan trade-off, **(d)** perubahan nyata, **(e)** tes otomatis dan perangkat nyata, **(f)** kegagalan/batas yang tersisa, **(g)** keputusan fase berikutnya. Gunakan contoh sintetis. Jangan mengubah hipotesis menjadi fakta atau menjanjikan fitur yang belum dijalankan.

## 10. Checkpoint 3 November 2026

**Sudah:** kerangka dua mode; inspeksi visual dan alpha maskot kanonis di dalam APK; lock Git SHA; prototype web Chatbot/Pendamping dengan satu SSE, satu balon berpage, gesture/drag dan input bawah; service overlay Android native, izin opt-in, tombol berhenti, navigasi dan draf sementara per-akun; jalur micro-LLM yang **OFF secara default**; build APK debug pertama berhasil. Next/Vercel lama dilarang sebagai acuan. Bukti implementasi adalah PR #15, sedangkan tahap desain masih dicatat di dokumen ini.

**Belum:** pose animasi tangan yang benar-benar melindungi kepala/bagian pribadi (sprite saat ini hanya gerak lembut, bukan animasi tulang), uji overlay/IME pada HP fisik, uji sejumlah merek Android, autentikasi global produksi, aktifkan micro-LLM, dan pengiriman pesan langsung dari overlay (sementara hanya mengirim draf ke Chatbot). APK masih debug dan belum lulus gate F4/F5. Kredensial penandatanganan lama yang pernah masuk riwayat Git publik harus dirotasi sebelum rilis.

**Langkah pertama berikutnya:** tuntaskan uji nyata F3 (tap alpha, rotasi, keyboard, izin overlay, perbedaan vendor), validasi pose turunan maskot **tanpa mengubah tulisan AAi**, lalu selesaikan pengamanan login F4 sebelum mengaktifkan model reaksi cepat atau mendistribusikan APK pribadi.


## F1.A — Implementasi rig animasi Pendamping (4 November 2026)

**Branch uji:** feat/aai-companion-rig-motion-20261104 (berasal dari fix/aai-companion-no-double-icon-20261103).

**Alasan perubahan / catatan dataset:**
- Pengguna melaporkan PNG hanya bergeser/berputar, tanpa gerak tangan. Gerakan seluruh gambar tidak memenuhi kebutuhan ekspresif dan respons kontekstual.
- Gunakan *pixel-part cutout rig* dari master public/aai-mascot-studio.png (1230×1278), bukan mengganti karakter. Delapan wilayah raster mencakup tangan kiri/kanan, rambut samping kiri/kanan, ujung pakaian kiri/kanan, pita kiri/kanan. Teks **AAi** di kristal tetap berada pada lapisan inti yang tidak dipotong.
- Renderer Canvas 2D membuang piksel posisi awal setiap potongan dan menggambar kembali potongan yang diputar pada sendinya. Gerak tangan bukan translasi satu PNG. Perkiraan bentuk dan sambungan perlu audit visual pada ukuran HP; ini masih rig prototipe, bukan ilustrasi frame tidur meringkuk yang disempurnakan.
- States: sleep (awal), wake, idle, think (sebelum token), talk (streaming), shy (sentuhan), happy (selesai), fly (tombol uji). Otomatis tidur lagi setelah 42 detik idle.
- Gambar kanonis dipertahankan sebagai fallback serta sumber hit-test alpha; Canvas akan aktif hanya jika dimensi master sesuai. Gerak maksimal ~30 FPS dan berhenti saat tab tersembunyi; opsi Kurangi Gerakan/reduced-motion menghasilkan gambar statis.
- Mode Chatbot, satu SSE, pagination balon komik, dan composer bawah tidak diubah. Tombol ✦ Coba AAi terbang hanya menguji web animasi; tidak menambah APK atau overlay native baru.

**Validasi yang wajib sebelum menganggap final:** cek jahitan batas segmen, bentuk mata/mulut tertutup, rambut/gaun saat bergerak, sentuhan kepala/tubuh, tombol terbang, perubahan dari berpikir ke bicara, reduced motion, tab background, drag, orientasi HP, performa/baterai. Jika tampak ada bagian terpotong atau identitas kristal rusak, jangan deploy ke produksi: revisi koordinat rig atau produksi keyframe ilustrasi manual dari master.


## F1.B — Audit kode Pendamping (4 November 2026, PR #17)

**Temuan terkonfirmasi dari inspeksi source:**
- Saat `tick()` berpindah dari tidur→bangun, bangun→diam, malu→diam, atau terbang→diam, `setPhase()` memanggil `ensure()` ketika timer kosong. `tick()` sebelumnya selalu menjadwalkan RAF baru tanpa mengecek timer yang sudah dijadwalkan. Hasilnya dua loop aktif, dan jumlahnya dapat bertambah. Perbaikan: jadwalkan RAF hanya bila belum ada timer.
- Sentuhan pada maskot sebelumnya mengubah preferensi `composer=false` menjadi `true`. Ini melanggar pilihan pengguna untuk menyembunyikan kolom ketik. Perbaikan: reaksi sentuhan tidak lagi mengubah preferensi.
- Alpha hit-test sebelumnya memakai koordinat PNG diam; setelah tubuh berputar saat tidur/terbang, titik sentuh dan gambar tidak cocok. Perbaikan: sampel transparansi dari frame Canvas yang benar-benar ditampilkan, lalu balik transformasi tubuh untuk klasifikasi zona; bila Canvas tak tersedia, gunakan peta PNG lama.
- Tap di area transparan sebelumnya tetap menambah hitungan sentuhan berulang, meskipun tidak bereaksi. Perbaikan: hitungan hanya bertambah pada hit yang sah.
- Tombol uji terbang berada di dalam panel pengaturan yang tetap terbuka dan dapat menutupi animasinya. Perbaikan: panel menutup sebelum terbang.
- Aset gambar dapat memicu `onImage()` melalui event `load` dan pemeriksaan gambar cache. Perbaikan: lindungi inisialisasi agar Canvas tidak terpasang dua kali.

**Batas validasi:** Browser lokal terhubung tidak tersedia pada sesi ini. Pemeriksaan di atas berbasis kode, dan CI otomatis hanya membuktikan logika/build—belum membuktikan kualitas visual. Gate visual pada HP (jahitan segmen, mata/mulut, gerak tidur) tetap **BELUM LULUS**. Jangan gabungkan PR atau deploy produksi sebelum uji visual.


## F1.C — Balon jawaban dan Send di HP (4 November 2026)

**Keluhan:** chat pengguna tidak boleh tertimpa karakter/balon, dan tombol Send harus tetap di dalam baris kolom input. Pengiriman dari mode Pendamping tetap memakai satu request/riwayat SSE yang sama; tidak boleh membuka Chatbot atau membuat maskot ganda.

**Temuan di source:**
- Markup hanya memiliki satu `#sendBtn`. CSS lama pada breakpoint HP menyembunyikan `.send-btn` sambil mengharapkan `#mobileSendBtn` (yang tidak ada di markup). CSS studio lebih baru memang menampilkan kembali Send, tetapi mengubah composer menjadi kolom sementara elemen Send tetap berada di luar baris teks. Urutan visual tidak konsisten.
- `reactToTouch()` memanggil `showSpeech()`, yang mengosongkan `pages` dan `fullText`. Ini tidak menghapus pesan pada sesi backend, tetapi balon jawaban sebelumnya hilang dari tampilan saat maskot disentuh.
- Alur web `handleSend()` sendiri sudah mengirim ke `sendMessage()` dan meneruskan SSE ke `AAiCompanionBridge`; tidak memerlukan peralihan mode. Perilaku overlay native Android yang membuka layar Chatbot adalah tahap terpisah dan **belum diperbaiki** pada perubahan web ini.

**Perbaikan:** tata letak grid tiga kolom (+, teks, Send) dengan satu tombol Send untuk Chatbot dan Pendamping, termasuk ukuran sentuh HP; reaksi maskot disimpan sementara lalu balon jawaban sebelumnya dipulihkan setelah 3,2 detik. Saat chat baru dimulai atau mode berpindah, pemulihan reaksi lama dibatalkan agar tidak menimpa respons streaming terbaru.

**Tes wajib:** CSS dan unit test otomatis, lalu audit layar HP untuk respons keyboard virtual, elemen tidak saling tindih, Send/Stop saat streaming, serta sentuhan beruntun dan chat baru yang datang sebelum balon reaksi kembali. **Belum divalidasi secara visual** karena browser terhubung tidak tersedia pada sesi ini. Jangan mengklaim bug overlay Android selesai sebelum APK native terpisah diuji.
