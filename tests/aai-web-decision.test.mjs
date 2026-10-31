import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Exercise the real TypeScript router, not a copied regex or an LLM's prediction.
const source = readFileSync(new URL('../src/aai-web.ts', import.meta.url), 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { decideWebSearch, hasWebSearchOptOut } = await import(
  'data:text/javascript;base64,' + Buffer.from(transpiled).toString('base64')
);

test('explicit no-web requests outrank detected search keywords and freshness', () => {
  const requests = [
    'Buat mini tutorial Node.js: heading, daftar, dan kode. Jangan mencari web.',
    'Apa kurs rupiah hari ini? Jangan cari di internet.',
    'Cek berita terbaru, tapi tanpa pencarian web.',
    'Jelaskan PKPU terbaru dari pengetahuanmu saja.',
    'Jangan browsing. Jelaskan alasanmu.',
    'Jangan gunakan Tavily atau Exa untuk jawaban ini.',
    'Please do not search the web for the latest news.',
    'Jangan searching di Google, jawab dari ingatanmu saja.',
    'Cari sumber resmi, tetapi jangan mencari web kali ini.',
    'Apa harga terbaru? Tidak perlu internet.',
  ];
  for (const request of requests) {
    assert.equal(hasWebSearchOptOut(request), true, request);
    assert.equal(decideWebSearch(request).search, false, request);
  }
});

test('the user restriction survives long prompts with a prohibition at the end', () => {
  const request = 'Apa perkembangan harga terbaru? ' + 'Jelaskan secara singkat. '.repeat(25) + 'Jangan mencari web.';
  assert.ok(request.length > 350);
  assert.equal(decideWebSearch(request).search, false);
});

test('real search requests and time-sensitive questions still use auto search', () => {
  for (const request of [
    'Cari sumber resmi kapan Node.js 24 dirilis.',
    'Apa kurs rupiah hari ini?',
    'Tolong cek berita terbaru tentang JavaScript.',
    'Coba jawab dari bobot dulu, kemudian cari sumber resmi kapan Node.js 24 dirilis.',
  ]) {
    assert.equal(hasWebSearchOptOut(request), false, request);
    assert.equal(decideWebSearch(request).search, true, request);
  }
});

test('ordinary conversations, sensitive data, and family matters stay off the web', () => {
  for (const request of [
    'Buat mini tutorial Node.js dengan Markdown dan kode.',
    'Jelaskan apa itu closure JavaScript.',
    'Bagaimana kabar istriku sekarang?',
    'Periksa api key milikku: sk-example123456789.',
  ]) {
    assert.equal(decideWebSearch(request).search, false, request);
  }
});

test('server honors no-web constraints beyond the keyword router', () => {
  const server = readFileSync(new URL('../src/chat.ts', import.meta.url), 'utf8');
  assert.match(server, /const webSearchOptedOut = hasWebSearchOptOut\(message\)/);
  assert.match(server, /if \(webSearchOptedOut\) \{/);
  assert.match(server, /Tanpa pencarian web, sesuai permintaanmu/);
  assert.match(server, /Jangan mengaku memakai Tavily, Exa/);
  assert.match(server, /if \(webDecision.search && webSearchAllowed\)/);
});
