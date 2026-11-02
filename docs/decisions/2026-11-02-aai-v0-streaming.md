# ADR-2026-11-02 — Streaming jawaban AAi v0 saat tool web tersedia

- **Status:** Eksperimen terkontrol, implementasi di PR #3; verifikasi runtime dilakukan setelah deploy.
- **Tanggal:** 2026-11-02 (Asia/Jakarta)
- **Ruang lingkup:** AAi v0 (Cloudflare Workers + OpenRouter + Tavily/Exa). **Bukan** perubahan model atau dataset Benih AAi.
- **Pemilik keputusan:** Teguh Putra. AAi v0 diperlakukan sebagai sarana eksperimen; risiko harus tercatat dan percakapan/secret tetap dilindungi.

## Gejala terukur sebelum perubahan

Uji manual melalui Browser Extension pada aplikasi live menghasilkan:

| ID | Pertanyaan sintetis | Perilaku |
|---|---|---|
| T2 | Cerita robot enam paragraf, eksplisit *jangan cari web* | Panjang teks bertambah pada sampel 7,5; 8; 8,5; 9; 9,5 detik. Streaming benar-benar berfungsi. |
| T3 | Penjelasan kompas enam paragraf, izin web tidak dilarang | Hanya laporan 'memeriksa apakah perlu mencari' sampai sekitar 10 detik; jawaban muncul sekaligus sekitar 10,5 detik. |
| T4 | Cari dokumentasi resmi Cloudflare Workers | Laporan tool muncul sekitar 2,25 detik, sumber sekitar 4,5 detik; jawaban final baru muncul sekaligus sekitar 10,5 detik. |

Pengukuran adalah polling perubahan DOM di tab ekstensi, **bukan** pengukuran paket jaringan. Waktu bersifat perkiraan. Pesan uji netral; sesi lama tidak dihapus.

## Akar masalah yang ditelusuri pada kode

Pada jalur izin web, `src/chat.ts` menawarkan `search_web` pada model dan menerima *stream* dalam mode `bufferUntilToolDecision=true`. Model boleh mengirim konten biasa tanpa tool. Karena keseluruhan putaran itu tertampung, jawaban yang semestinya terlihat per token baru dilepas sesudah putaran selesai. Jalur tanpa tool tidak memiliki penahanan tersebut. Parser SSE di `public/assets/js/app.js` telah mampu merender delta.

Buffer semula ada untuk alasan valid: jangan tampilkan query tool, pengakuan pencarian yang belum terjadi, atau teks sementara yang kelak perlu diganti.

## Keputusan teknis di PR #3

1. **Jalur cepat berdasarkan intent:** permintaan stabil/sehari-hari dengan `decideWebSearch(...).search=false` langsung ke model tanpa schema tools. Izin web tetap merupakan batas; kasus sensitif dan `jangan cari web` tidak diberi akses tool.
2. **Putaran keputusan saja untuk web:** saat ada kebutuhan informasi mutakhir/pencarian publik, model dengan tools hanya diminta memilih `search_web` atau penanda `SIAP_MENJAWAB`. Output putaran ini tidak dirender sebagai jawaban publik, dengan batas 320 token.
3. **Komposisi final langsung streaming:** setelah model menolak pencarian berikutnya atau batas putaran tercapai, panggilan model terakhir tanpa tool menghasilkan token SSE satu per satu. Pencarian berulang tetap mungkin hingga batas aman yang sudah ada.
4. **Fallback jujur:** bila provider pencarian tidak tersedia, instruksi tidak mengklaim pertanyaan tersebut 'tidak perlu web'; jawaban harus menyatakan keterbatasan verifikasi.
5. **Judul sesi:** diturunkan setelah token jawaban final, bukan dari penanda keputusan tool.

## Alternatif yang ditolak / ditunda

- **Streaming spekulatif putaran tool:** cepat, tetapi bisa sekilas menampilkan klaim pencarian palsu atau query yang kemudian dihapus. Ditolak demi konsistensi dan privasi.
- **Mematikan tools global:** membuat chat cepat tetapi merusak pencarian informasi mutakhir. Ditolak.
- **Selalu dua panggilan untuk semua chat:** menambah latensi dan biaya untuk obrolan sederhana. Ditolak.
- **Preface bebas dari penalaran internal:** perlu rancangan event publik yang benar-benar terpisah. Ditunda ke P1; jangan mengekspos chain-of-thought.
- **Animasi karakter palsu yang seolah streaming:** menutupi bug tetapi bukan streaming nyata. Ditolak.

## Trade-off dan risiko

- Heuristik intent dapat salah menilai permintaan yang diam-diam butuh web. Pengguna dapat memicu dengan instruksi eksplisit `cari sumber`; ini perlu diukur dengan dataset intent.
- Untuk permintaan web, panggilan keputusan + panggilan jawaban dapat meningkatkan biaya dan *time to first answer*. Keuntungannya progres tool benar dan teks akhir dapat mengalir.
- Batas 320 token berisiko terlalu singkat pada model/provider tertentu; awasi tingkat tool call yang kosong/gagal.
- Model dapat mengabaikan `SIAP_MENJAWAB`; backend tetap memperlakukan teks putaran keputusan sebagai privat dan melakukan komposisi final.
- Belum boleh mengklaim *fixed in production* hanya berdasarkan unit test.

## Bukti verifikasi sebelum deployment

- `npm test`: **71/71 pass**.
- `tsc --noEmit --allowImportingTsExtensions`: pass.
- `wrangler deploy --dry-run`: pass.
- Sintaks `app.js`: pass.
- GitHub Actions untuk PR #3: pass (run #18 pada commit sebelum catatan ini).
- `git diff --check`: pass untuk source.

## Protokol penerimaan sesudah deployment

Ulangi T2, T3, T4 dengan polling DOM sepanjang respons (bukan hanya screenshot akhir). T3 harus memiliki lebih dari satu pertambahan teks ketika tombol Hentikan masih aktif. Pada T4, status sumber boleh bertahap dan jawaban final juga harus bertambah per potongan. Periksa tool timeout, pembatalan, sesi lama, log tanpa secret, dan pengaruh latensi. Jika terjadi error serius atau pencarian terdegradasi, rollback ke Worker versi sebelumnya.

## Pelajaran untuk dataset perubahan

Pisahkan **observasi → hipotesis → perubahan → hasil uji → keterbatasan**. Jangan menandai hipotesis sebagai bukti. Commit dan PR harus menyebut mengapa trade-off dipilih, bukan hanya “fix streaming”. Saat eksperimen gagal pun simpan pembelajarannya tanpa menyimpan teks rahasia pengguna.

## Addendum 2026-11-02 — bukti produksi dan regresi T4

**Lingkungan:** GitHub PR #3 merged ke `design/aai-crystal-refresh`; Actions push run #21 sukses untuk `test-and-build` serta deploy; Worker 100% pada versi `61e69fd3-bb35-47fc-abc0-8445a7cfd70a`. Pengamatan dilakukan melalui ekstensi browser pada origin AAi yang ter-deploy.

1. **T3 streaming lolos.** Permintaan menjelaskan kompas enam paragraf tanpa niat web mengirim jawaban bertahap. DOM utama bertambah kira-kira 416 → 560 → 699 → 840 → 1000 → 1094 → 1243 → 1387 → 1536 karakter ketika tombol Hentikan masih aktif (sekitar detik 10,5–14,5). Artinya teks respons memang mengalir, meskipun TTFT ~10 detik belum optimal.
2. **T4 web-search regresi.** Kalimat persis: `UJI TOOL WEB: Cari dokumentasi resmi Cloudflare tentang streaming response di Workers. Sebutkan tautan resminya dan ringkaskan dua poin utama.` Tidak membuka alat web. AAi menjawab dari pengetahuan sendiri dan mengaku tidak menjalankan pencarian. **Kegagalan alat bukan karena token kosong:** penyebabnya dapat direproduksi pada `decideWebSearch`; pola `EXPLICIT_SEARCH` mencakup `cari sumber` tetapi tidak `cari dokumentasi resmi`. P0 membuat hasil gate ini menentukan apakah alat ditawarkan ke model.
3. **Perbaikan susulan:** perluas intent eksplisit untuk dokumentasi resmi, jurnal/paper, dan permintaan tautan/situs resmi; pertahankan larangan web eksplisit dan filter privasi. Tambahkan regresi unit dengan kalimat T4 aktual serta variasi pencarian dokumentasi.
4. **Verifikasi sebelum deploy susulan:** `npm test` **71/71 lulus**, `tsc --noEmit --allowImportingTsExtensions` lulus, termasuk assert bahwa T4 wajib menuju jalur keputusan alat, sementara obrolan biasa tetap jalur langsung.
5. **Keputusan dataset:** pertahankan bukti T4 gagal walaupun T3 berhasil. Satu label `streaming fixed` tidak mewakili dua properti berbeda: *streaming final answer* dan *routing tool sesuai kebutuhan*. Keduanya wajib diuji terpisah setiap kali gate diubah.

**Status uji setelah deploy susulan:** menunggu smoke test dengan prompt T4 yang sama. Catatan ini tidak mengklaim pencarian sudah sukses di produksi.
