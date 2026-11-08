import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const webSource = readFileSync(new URL('../src/aai-web.ts', import.meta.url), 'utf8');
const webModule = ts.transpileModule(webSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { decideWebSearch, shouldRunWebToolDecision, shouldOfferWebToolToModel } = await import(
  'data:text/javascript;base64,' + Buffer.from(webModule).toString('base64')
);

const chatSource = readFileSync(new URL('../src/chat.ts', import.meta.url), 'utf8');

test('the selected model decides on every permitted turn, without keyword triggers', () => {
  const messages = [
    'Halo AAi, kamu lagi apa?',
    'Buat cerita enam paragraf tentang robot kecil merawat taman.',
    'Jelaskan dengan sederhana cara kerja kompas dalam enam paragraf.',
    'Apa kabar KPU sekarang?',
  ];
  for (const message of messages) {
    assert.equal(shouldOfferWebToolToModel(message, 'allow', true), true, message);
  }
  assert.equal(shouldOfferWebToolToModel('Jangan cari web, jawab dari bobot saja.', 'allow', true), false);
  assert.equal(shouldOfferWebToolToModel('Aku pulang kerja dan Ayaka minta bermain, bagaimana ya?', 'allow', true), false);
  assert.equal(shouldOfferWebToolToModel('Apa kabar KPU sekarang?', 'deny', true), false);
  assert.equal(shouldOfferWebToolToModel('Apa kabar KPU sekarang?', 'allow', false), false);
});

test('web permission and providers gate actual searches even for fresh questions', () => {
  const decision = decideWebSearch('Cari sumber resmi tentang streaming Cloudflare Workers.');
  assert.equal(decision.search, true);
  assert.equal(shouldRunWebToolDecision(decision, 'deny', true), false);
  assert.equal(shouldRunWebToolDecision(decision, 'allow', false), false);
  assert.equal(shouldRunWebToolDecision(decision, 'allow', true), true);
  assert.equal(shouldRunWebToolDecision(decideWebSearch('Cari sumber resmi, tapi jangan cari web.'), 'allow', true), false);
  assert.equal(shouldRunWebToolDecision(decideWebSearch('Cari dokumentasi resmi Cloudflare tentang streaming response di Workers.'), 'allow', true), true);
});

test('a tool-decision response never becomes a single buffered public answer', () => {
  assert.match(chatSource, /const shouldRunToolDecision = !visionImages\.length && !webSearchOptedOut/);
  assert.match(chatSource, /if \(shouldRunModelToolDecision\) \{/);
  assert.match(chatSource, /if \(shouldRunToolDecision && requestedWebDecision\.explicit\)/);
  assert.match(chatSource, /const shouldRunModelToolDecision = !visionImages\.length[\s\S]*?shouldOfferWebToolToModel\(message, requestBody\.value\.webPermission, hasSearchProvider\)[\s\S]*?!requestedWebDecision\.explicit/);
  assert.match(chatSource, /tanggal dan waktu lokal yang tersedia di konteks sistem/);
  assert.match(chatSource, /jangan menunggu pengguna mengucapkan kata/);
  assert.match(chatSource, /\[KEPUTUSAN TOOL SAJA\]/);
  assert.match(chatSource, /max_tokens: 320/);
  assert.match(chatSource, /await receiveProviderResponse\(result\.response, nativeCalls, true\)/);
  assert.match(chatSource, /replyParts\.length = 0;\s*emittedTokenCount = 0;\s*displayFilter = createAAiMemoryStreamFilter\(\);/);
  assert.doesNotMatch(chatSource, /displayFilter\.push\(candidate\)/);
  assert.match(chatSource, /await receiveProviderResponse\(final\.response\)/);
  assert.match(chatSource, /const finalPayload: ProviderRequestBody = \{[\s\S]*?messages: finalMessages/);
  assert.match(chatSource, /if \(!shouldRunToolDecision && !shouldRunModelToolDecision\)/);
});

test('tool failure never silently turns an explicit search into an unverified answer', () => {
  assert.match(chatSource, /const toolChoice = 'auto'/);
  assert.match(chatSource, /failUnexecutedSearch\('Model mengirim teks tanpa memanggil alat pencarian/);
  assert.match(chatSource, /const hasToolResults = providerPayload\.messages\.some\(item => item\.role === 'tool'\) \|\| directSearchCompleted/);
  assert.match(chatSource, /isAllowedPublicWebQuery\(message, query\)/);
  assert.match(chatSource, /upstreamAbortController\.abort\(\)/);
  assert.match(chatSource, /\[PENCARIAN TIDAK TERSEDIA\]/);
});
