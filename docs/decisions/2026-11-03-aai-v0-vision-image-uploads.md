# ADR — AAi v0 membaca gambar dan screenshot (vision)
Tanggal: 2026-11-03
Branch: feat/aai-vision-images-20261103
Base: design/aai-crystal-refresh

## Masalah dan bukti
- UI AAi telah lama menyediakan tombol lampiran dan mengirim `files: [{name,type,base64}]` ke `/api/chat`, tetapi `src/chat.ts` tidak pernah membaca `files`. Akibatnya model menerima teks tanpa pixel gambar.
- Pengguna meminta foto/screenshot dapat dianalisis langsung dari HP dan dialog aktivitas harus natural.
- Bukti eksternal: DeepSeek-V4.1-Flash-1017 menerima input teks dan gambar (OpenRouter model page https://openrouter.ai/deepseek/deepseek-v4.1-flash-1017/; DeepSeek changelog https://api-docs.deepseek.com/updates/); format resmi OpenRouter adalah `messages[].content=[{type:'text',text:'...'},{type:'image_url',image_url:{url:'data:image/...;base64,...'}}]`.

## Keputusan desain
- Bangun `src/aai-vision.ts` sebagai validator tanpa side effects dan pembentuk format multimodal.
- Maksimal 3 gambar per pesan; JPG/PNG/WebP; masing-masing maksimal 4 MiB, total maksimal 8 MiB; body maksimal 12 MiB. Periksa MIME, encoding base64, dan signature awal file di backend. Jangan izinkan SVG/HTML/dokumen menyamar sebagai foto.
- Client mempertahankan screenshot yang cukup kecil pada ukuran asli; hanya gambar besar di-resize (JPEG) untuk membatasi biaya dan mencegah upload ditolak.
- Image-only message diperbolehkan dengan prompt bawaan bahasa alami.
- Pilih model vision secara eksplisit melalui `OPENROUTER_VISION_MODEL` jika ada, jika tidak gunakan **`deepseek/deepseek-v4.1-flash-1017`** yang telah diverifikasi. Pilihan model gratis otomatis tidak dipakai untuk gambar karena bisa merutekan ke model teks.
- Data URL diberikan **hanya kepada provider OpenRouter** dalam request yang sedang berjalan. Tidak menyimpan base64 di `messages`, `activity_trace`, atau memori. History hanya mencatat jumlah gambar dan perlu upload ulang untuk regenerasi respons.
- Pada pesan bergambar **web search tidak diaktifkan**, sekalipun izin web ON, untuk menghindari bocornya data foto ke Tavily/Exa dan false claims. Jika pengguna meminta cari web dari foto, AAi menjelaskan batasnya secara jujur.
- User-facing preface: "Bentar, aku lihat gambarnya dulu, ya." dan progress hanya saat proses vision terjadi. Jangan tampilkan log provider atau berpura-pura memakai OCR terpisah.
- Untuk keselamatan memori, persistence otomatis dari output vision dinonaktifkan pada pesan bergambar; analisis visual biasa tetap tersimpan sebagai teks chat seperti respons lain.

## Tes penerimaan
1. JPG/PNG/WebP asli diterima; beberapa gambar terformat sebagai array text + image_url.
2. Salah MIME, base64 rusak, magic salah, 4 gambar atau file besar ditolak 400/413 sebelum provider.
3. Pesan tanpa gambar tetap menggunakan payload string dan streaming lama.
4. Prompt gambar tanpa teks diizinkan.
5. File tidak disimpan ke database; hanya marker `[📷 Lampiran gambar ...]`.
6. Regenerasi dari pesan gambar yang kehilangan byte asli memberi penjelasan agar unggah ulang.
7. Status vision terlihat natural, tak menampilkan jumlah catatan memori.
8. Tidak ada model call web atau penyimpanan memori pada jalur gambar.
9. CI: npm test, JS syntax, Wrangler dry-run; setelah merge, deploy Cloudflare, cek Worker aktif.
10. Tes live ideal: kirim screenshot sintetis berisi teks unik, pastikan jawaban menyebut isi visual bukan mengarang, cek pada HP dan jaringan lambat. Jangan menguji dengan dokumen pribadi.
11. Pengujian gagal (model endpoint vision ditolak) harus dilaporkan sebagai gagal; jangan menyembunyikan pesan error.

## Risiko dan keputusan lanjut
- Akun AAi masih memakai login username-only; PR #8 autentikasi terverifikasi belum deploy. Jangan mengklaim akses privat kuat.
- Foto diunggah ke OpenRouter sebagai layanan pihak ketiga berdasarkan pilihan eksplisit pengguna; tidak dikirim ke web search. UI menyebut bahwa lampiran diproses oleh model.
- Provider vision dapat menghalusinasikan teks sangat kecil; beri batasan dan jangan menebak angka/dokumen resmi.
- Safari HEIC, PDF dan dokumen masih belum diterima sebagai gambar di rilis ini; prioritaskan setelah format dasar lolos.
- Tanpa penyimpanan file, riwayat tidak menampilkan foto setelah reload; kompromi privasi disengaja. Jika kelak ingin thumbnail persisten, gunakan storage privat dengan autentikasi kuat dan retensi eksplisit.
- Jangan mengubah tokenizer, data Benih AAi 30M, atau sistem memori keluarga dalam eksperimen vision UI.
- Commit terpisah menandai **alasan** (payload dulu dibuang), **perubahan** (multimodal data URL), **risiko** (privacy, cost, HEIC) dan **tes** untuk dataset audit.
