import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/aai-tools.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { SEARCH_WEB_TOOL, addNativeToolDeltas, completedNativeToolCalls, extractSearchWebQuery,
  sanitizeUnverifiedToolOpening, looksLikeUnexecutedSearchPayload } = await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
);

test('native tool schema keeps the model on a narrow public search tool', () => {
  assert.equal(SEARCH_WEB_TOOL.type, 'function');
  assert.equal(SEARCH_WEB_TOOL.function.name, 'search_web');
  assert.deepEqual(SEARCH_WEB_TOOL.function.parameters.required, ['query']);
  assert.equal(SEARCH_WEB_TOOL.function.parameters.additionalProperties, false);
});

test('OpenRouter streamed tool-call fragments are accumulated and parsed', () => {
  const pending = new Map();
  addNativeToolDeltas(pending, [{ index: 0, id: 'call_abc', type: 'function', function: { name: 'search_', arguments: '{"que' } }]);
  addNativeToolDeltas(pending, [{ index: 0, function: { name: 'web', arguments: 'ry":"Node.js 24' } }]);
  addNativeToolDeltas(pending, [{ index: 0, function: { arguments: ' release date"}' } }]);
  const calls = completedNativeToolCalls(pending);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, 'search_web');
  assert.equal(extractSearchWebQuery(calls[0]), 'Node.js 24 release date');
});

test('malformed, unsupported, and oversized tool arguments never produce a query', () => {
  const base = { id: 'call_x', type: 'function', function: { name: 'search_web', arguments: '' } };
  for (const args of ['not-json', '{}', '{"query":1}', '{"query":"ok"}', '{"query":"okay","extra":true}', '{"query":"' + 'x'.repeat(300) + '"}']) {
    assert.equal(extractSearchWebQuery({ ...base, function: { ...base.function, arguments: args } }), null);
  }
  assert.equal(extractSearchWebQuery({ ...base, function: { name: 'delete_file', arguments: '{"query":"Node.js"}' } }), null);
  assert.deepEqual(completedNativeToolCalls(new Map()), []);
});

test('a pre-tool statement cannot claim the search already ran or returned no results', () => {
  assert.equal(sanitizeUnverifiedToolOpening('Hasil pencariannya kosong, Bos. Nggak ada berita yang masuk. Coba aku cari ulang.'), '');
  assert.equal(sanitizeUnverifiedToolOpening('Aku sudah mencari dan menemukan 5 sumber.'), '');
  assert.equal(sanitizeUnverifiedToolOpening('Nggak ada berita yang masuk, aku cari lagi.'), '');
  assert.equal(sanitizeUnverifiedToolOpening('Bentar, Guh. Aku cari dulu, ya.'), 'Bentar, Guh. Aku cari dulu, ya.');
  assert.equal(sanitizeUnverifiedToolOpening('Baik, aku perlu cek sumbernya dulu.'), 'Baik, aku perlu cek sumbernya dulu.');
});

test('a raw search query or tool-call syntax is not an assistant answer', () => {
  assert.equal(looksLikeUnexecutedSearchPayload('berita Raffi Ahmad terbaru Juni 2026'), true);
  assert.equal(looksLikeUnexecutedSearchPayload('{"query":"berita Raffi Ahmad terbaru"}'), true);
  assert.equal(looksLikeUnexecutedSearchPayload('search_web({"query":"OpenAI news"})'), true);
  assert.equal(looksLikeUnexecutedSearchPayload('Aku belum bisa cek berita terbaru secara langsung.'), false);
  assert.equal(looksLikeUnexecutedSearchPayload('Ini lima fakta yang dapat kujelaskan.\nPertama...'), false);
});
