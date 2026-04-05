# Sesi Berikutnya: Pecah api/chat.js Menjadi Modul-Modul Kecil

## Cara Memulai Sesi Baru
Sesi chat baru tidak otomatis membawa seluruh konteks percakapan lama.

Yang tetap ada:
- file di workspace, termasuk `NEXT_SESSION_PROMPT.md`
- kode terakhir di repo
- repo memory yang tersimpan di workspace

Yang tidak otomatis ikut penuh:
- detail percakapan lama
- alasan keputusan yang hanya pernah disebut di chat, tapi tidak ditulis ke file/memory

Jadi saat mulai sesi baru, gunakan pola ini:

```text
Baca NEXT_SESSION_PROMPT.md ini dulu, lalu baca repo memory yang relevan, cek kondisi terbaru api/chat.js, api/messages.js, dan assets/js/app.js, ringkas state terkini, baru lanjutkan pekerjaan.
```

Aturan penting untuk sesi baru:
- Anggap file ini sebagai handoff, bukan kebenaran mutlak.
- Jika isi file ini berbeda dengan kondisi kode terbaru, prioritaskan kode yang ada di workspace.
- Jika rencana di file ini belum pernah dijalankan, itu tidak masalah; perlakukan sebagai proposal kerja berikutnya.
- Sebelum eksekusi refactor, cek dulu apakah reasoning preview masih aktif dan kontrak payload client belum berubah.

## Konteks Latar Belakang
Sesi ini sudah mengubah preview AI dari tampilan ambiguity menjadi reasoning natural.

Kondisi terbaru yang harus dianggap sebagai baseline benar:
- `message_previews.preview_json` sekarang menyimpan payload penuh: `reasoning_steps` untuk UI + `ambiguity` untuk audit backend.
- Frontend tidak lagi merender blok "Interpretasi AI / Potensi Ambigu / Asumsi AI / Checklist Konteks".
- Frontend sekarang hanya mengonsumsi preview yang sudah disanitasi menjadi `reasoning_steps`.
- Judul panel preview saat streaming adalah `AAI sedang berpikir`, lalu setelah selesai menjadi `AAI`.
- `api/chat.js` makin padat karena sekarang memegang logika memory, preview reasoning, prompt/context, file processing, provider retry, dan handler HTTP sekaligus.

Jadi sesi berikutnya sebaiknya fokus utama ke **memecah file**, bukan langsung utak-atik perilaku besar. Setelah file sudah lebih rapi, baru refactor prompt blocks jadi lebih aman.

## Tujuan Utama Sesi Ini
1. Pecah `api/chat.js` menjadi beberapa modul helper yang jelas tanggung jawabnya.
2. Jadikan `api/chat.js` lebih tipis sebagai orchestration layer / request handler.
3. Setelah split stabil, baru lanjut tahap kecil: pecah `runtimeContextPrompt` menjadi beberapa system blocks.
4. Pastikan reasoning preview yang baru tidak rusak setelah refactor.

## Kondisi Teknis Saat Ini
- `buildIdentityContext()`, `buildConsistencyLock()`, dan `buildFinalContextBlock()` sudah ada dan cukup jelas untuk dipisah ke modul context builder.
- `buildReasoningSteps()`, `buildClientPreviewPayload()`, dan `analyzeAmbiguityPreview()` sekarang adalah satu cluster preview/reasoning yang kuat dan sebaiknya dipindah bersama.
- `runtimeContextPrompt` saat ini masih satu blok string yang dibangun dari `buildFinalContextBlock()`.
- `openRouterPayload.messages` masih memakai pola:

```javascript
messages: [
  systemPrompt,
  runtimeContextPrompt,
  ...(compactInstructionPrompt ? [compactInstructionPrompt] : []),
  ...chatHistory,
  { role: 'user', content: userMessage }
]
```

- `api/messages.js` dan `assets/js/app.js` sekarang bergantung pada kontrak preview yang sudah disanitasi:

```javascript
{
  title: 'AAI',
  streaming_title: 'AAI sedang berpikir',
  reasoning_steps: [...]
}
```

Refactor file berikutnya **tidak boleh** merusak kontrak ini.

## Peta Modul yang Disarankan
Target bukan harus persis begini, tapi ini pembagian yang paling masuk akal dari kondisi saat ini:

### 1. `api/_lib/chat-memory.js`
Isi kandidat:
- `normalizeMemoryType`
- `normalizeMemoryKey`
- `normalizeMemoryText`
- `computePriorityScore`
- `jaccardSimilarity`
- `parseMemoryTagPayload`
- `parseMemoryInstructionTags`
- `buildMemoryContext`
- `detectMemoryIntent`
- `getIntentMemoryTypes`
- `resolveMemoryScoreWeights`
- `normalizeMemoryExperimentMode`
- `resolveMemoryExperimentProfile`
- `computeFreshnessScore`
- `computeRelevanceToQuery`
- `selectRelevantMemories`

### 2. `api/_lib/chat-context.js`
Isi kandidat:
- `buildIdentityContext`
- `buildConsistencyLock`
- `buildFinalContextBlock`
- `buildLastChatContext`
- `compactHistoryMessage`
- `buildOlderHistorySummary`
- `extractCheckpointSummary`
- `stripCheckpointControlBlocks`
- `stripClarifyControlBlocks`

### 3. `api/_lib/chat-preview.js`
Isi kandidat:
- `analyzeAmbiguityPreview`
- `collectMatchedTerms`
- `detectConversationEmotion`
- `detectReasoningIntent`
- `buildReasoningSteps`
- `buildLegacyReasoningSteps`
- `buildClientPreviewPayload`

Catatan penting:
- Di modul ini, ambiguity tetap backend-only.
- Yang boleh keluar ke client tetap preview sanitized berbasis `reasoning_steps`.

### 4. `api/_lib/chat-files.js`
Isi kandidat:
- `uploadFileToStorage`
- `extractPdfText`
- `sanitizeGeneratedFileBlock`
- `toSlug`
- `normalizeCellValue`
- `pickBestDelimiter`
- `parseDelimitedLines`
- `parseXlsbRows`
- `parseSheetBlocks`
- `findJoinColumnIndex`
- `buildSandingWorkbookSheets`
- `applyWorksheetColumnWidths`

### 5. `api/_lib/chat-provider.js`
Isi kandidat:
- `getModelConfig`
- `buildModelCandidates`
- `callOpenRouterWithRetry`
- helper env parsing seperti `parsePositiveIntEnv`, `parseFloatEnv`, `sleep`

### 6. `api/chat.js`
Ideal akhirnya hanya memegang:
- handler GET/POST
- orchestration ambil data user/person/session/history
- rakit prompt
- panggil provider
- stream SSE
- simpan DB

## Tahap Kedua Setelah File Sudah Terpecah
Kalau pemecahan file sudah aman, baru lanjut refactor prompt besar menjadi beberapa system blocks:

```javascript
const systemIdentity = {
  role: 'system',
  content: buildIdentityContext(...)
};

const systemConsistency = {
  role: 'system',
  content: buildConsistencyLock(...)
};

const systemMemoryContext = {
  role: 'system',
  content: buildMemoryContext(...)
};

const systemFinalInstruction = {
  role: 'system',
  content: buildFinalInstruction(...)
};
```

Tujuannya:
- prompt lebih gampang dituning
- file lebih gampang diuji
- kalau ada regresi, lebih gampang tahu blok mana yang menyebabkan masalah

## Checklist untuk Sesi Berikutnya
- [ ] Audit `api/chat.js` per cluster fungsi, bukan per baris acak.
- [ ] Buat folder helper baru, misalnya `api/_lib/`.
- [ ] Pindahkan cluster memory ke file terpisah tanpa mengubah behavior.
- [ ] Pindahkan cluster preview/reasoning ke file terpisah tanpa mengubah shape payload client.
- [ ] Pindahkan cluster file-processing ke file terpisah.
- [ ] Pindahkan cluster provider/retry ke file terpisah.
- [ ] Rapikan `api/chat.js` sampai fokus ke orchestration saja.
- [ ] Setelah split aman, evaluasi apakah `runtimeContextPrompt` siap dipecah jadi beberapa system blocks.
- [ ] Smoke test reasoning preview live chat.
- [ ] Smoke test buka ulang history session.
- [ ] Smoke test regenerate response.
- [ ] Smoke test request dengan lampiran file.

## Hal Yang Tidak Boleh Rusak
- `message_previews` tetap satu tabel, tidak perlu schema baru.
- `preview_json` tetap menyimpan reasoning + ambiguity audit.
- Client API hanya menerima preview sanitized untuk UI.
- Panel preview di frontend tetap menampilkan reasoning steps natural.
- SSE event reasoning tetap jalan sebelum token jawaban utama.
- Compact checkpoint flow jangan ikut rusak saat split file.

## File-File Penting
- `c:\aAi\api\chat.js` — file utama yang akan dipecah
- `c:\aAi\api\messages.js` — kontrak history preview sanitized
- `c:\aAi\assets\js\app.js` — renderer preview reasoning di frontend
- `c:\aAi\db_message_previews.sql` — referensi schema `message_previews`

## Notes Penting dari Sesi Ini
- Preview reasoning sudah aktif dan menggantikan tampilan ambiguity di UI.
- Ambiguity masih dipakai, tapi backend-only sebagai audit.
- Saat testing lokal, `vercel dev` sempat jalan di `http://localhost:3001` karena port 3000 sedang dipakai.
- Untuk sesi pecah file, lebih baik jaga behavior tetap sama dulu. Jangan sekaligus ganti arsitektur besar + ubah UX + ubah prompt behavior dalam satu langkah.

---
**Updated:** April 5, 2026  
**Status:** Ready untuk sesi pemecahan file
