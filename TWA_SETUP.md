# TWA APK Setup (AAi)

Domain production:
- https://a-ai-rust.vercel.app

## Kenapa update Vercel otomatis masuk APK?
- Karena model TWA membuka web app live dari domain di atas.
- Jadi saat kamu deploy update ke Vercel, isi app di APK ikut update otomatis.
- Rebuild APK hanya perlu kalau kamu ubah bagian native shell Android (icon APK, package id, signing, permission native, splash native).

## Status saat ini
- PWA endpoint valid:
	- /manifest.webmanifest -> 200
	- /sw.js -> 200
- Bubblewrap sempat berhasil download JDK ke:
	- C:\Users\ACER\.bubblewrap\jdk
- Blocker di sesi otomatis ini: prompt lisensi Android SDK dari Bubblewrap tidak kompatibel dengan terminal automation.

## Jalankan ini manual di terminal lokal (PowerShell)

1) Masuk folder proyek:

```powershell
cd C:\aAi
```

2) Inisialisasi TWA dari manifest production:

```powershell
npx @bubblewrap/cli init --manifest https://a-ai-rust.vercel.app/manifest.webmanifest
```

Saat ditanya, isi rekomendasi berikut:
- Application ID: `app.aai.rust`
- Name: `AAi`
- Launcher name: `AAi`
- Domain: `a-ai-rust.vercel.app`
- Start URL: `https://a-ai-rust.vercel.app/`
- Display mode: `standalone`
- Theme color: `#2a7a9e`
- Background color: `#f8fbff`
- Accept Android SDK terms: `Yes`

3) Build APK debug:

```powershell
npx @bubblewrap/cli build
```

4) Lokasi output (umum):
- `./app-release-signed.apk` atau
- `./app/build/outputs/apk/release/`

## Untuk update berikutnya
- Cukup deploy Vercel seperti biasa.
- APK tidak perlu rebuild jika hanya update konten/fitur web.
- Rebuild hanya jika ada perubahan native shell Android.

