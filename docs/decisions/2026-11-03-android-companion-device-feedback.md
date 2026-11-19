# AAi Companion — Hasil uji HP: tampilan dobel dan ikon lawas

**Tanggal:** 3 November 2026  
**Sumber:** laporan pengguna dari HP Android beserta screenshot (tidak disalin ke repo)  
**Status:** perbaikan di branch PR, perlu uji ulang pada perangkat nyata.

## Gejala dan sebab terverifikasi

1. **Dua balon dan dua composer** tampil pada layar AAi sendiri. Web Companion dan jendela native `TYPE_APPLICATION_OVERLAY` aktif bersamaan. Keduanya sengaja ada untuk konteks berbeda, tetapi belum disinkronkan dengan lifecycle Activity.
2. **Tombol bawah "Chat" membuka MainActivity.** Kode `CompanionOverlayService` membawa teks sebagai draf `AAI_COMPANION_DRAFT`, lalu `MainActivity` meneruskannya ke WebView. Belum ada pengiriman langsung/SSE dari native overlay; jangan menyebutnya tombol Kirim.
3. **Ikon launcher Android masih bawaan Capacitor lama**, padahal sumber PWA `public/icons/aai-512.png` sudah memakai maskot AAi yang benar.
4. **Gerak karakter masih satu PNG utuh.** Translasi/rotasi dengan animator bukan rig tangan. Tidak ada pose tangan menutupi kepala. Ini belum memenuhi gate animasi dari MD utama.

## Perbaikan pada branch ini

- Saat AAi berada di foreground, `MainActivity` memberi sinyal ke service untuk **menyembunyikan view overlay native**; web Companion tetap tersedia sebagai satu-satunya antarmuka dalam aplikasi.
- Saat beralih ke aplikasi lain, service foreground yang sebelumnya diaktifkan dengan izin pengguna menampilkan kembali maskot, balon, dan composer native. Teks jawaban terakhir tetap dipertahankan.
- Launcher Android memakai ulang `public/icons/aai-512.png` secara **identik**, tanpa menggambar ulang atau mengganti kristal AAi. Android menggunakan salinan blob yang sama di `drawable-nodpi/aai_brand.png`.
- Ditambah tes kontrak untuk lifecycle dan kesamaan byte aset ikon.
- APK debug memakai package **`id.aai.personal.qa`** dan label **AAi Uji**, supaya bisa dipasang di samping aplikasi AAi lama tanpa menghapus sesi lokalnya. Perubahan ini hanya untuk debug, bukan release.

## Yang belum dianggap selesai

- **Kirim langsung dari overlay:** harus memakai sesi autentikasi yang benar dan satu alur pesan/stream; saat ini draf tetap dibawa ke Chatbot agar tidak menciptakan jalur chat kedua yang rawan bocor lintas akun. Tidak mengklaim fitur ini sudah berfungsi.
- **Animasi anggota tubuh:** membutuhkan frame/rig berlapis dari maskot kanonis, dengan audit kesamaan wajah, tangan, pakaian, serta huruf AAi pada kristal. Tidak menyamarkan goyangan PNG sebagai animasi tangan.
- Uji fisik Android untuk pergantian foreground/background, keyboard, rotasi, vendor, battery saver dan pencabutan izin; status belum PASS.
- Autentikasi produksi belum layak untuk percakapan pribadi keluarga; pertahankan gate keamanan MD utama.

## Rencana uji ulang

1. Buka AAi dan aktifkan overlay, lalu tetap di aplikasi AAi: hanya web Companion yang tampil.
2. Pindah ke aplikasi Android lain: satu maskot native + satu balon + satu composer.
3. Kembali ke AAi: overlay native menghilang tanpa mematikan sesi atau menduplikasi balon.
4. Masukkan draf dari overlay: saat ini jelas membuka Chatbot; tidak mengaku mengirim langsung.
5. Periksa ikon di launcher setelah pemasangan APK baru dan uji lewat Android Actions artifact.
6. Uji apakah pada kembali dari layar izin / lock screen overlay pulih dengan benar.

**Keputusan desain:** tidak menyentuh model, korpus Benih AAi, database, login, sesi lama, atau deployment Worker produksi pada PR ini.
