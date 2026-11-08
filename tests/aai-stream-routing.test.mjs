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

test('the model router is offered for information requests, not ordinary statements', () => {
  const messages = [
    'Halo AAi, kamu lagi apa?',
    'Jelaskan dengan sederhana cara kerja kompas dalam enam paragraf.',
    'Apa kabar KPU sekarang?',
    'Siapa yang menyadap WA Presiden?',
    'Berita tentang istri Presiden',
  ];
  for (const message of messages) {
    assert.equal(shouldOfferWebToolToModel(message, 'allow', true), true, message);
  }
  assert.equal(shouldOfferWebToolToModel('Buat cerita enam paragraf tentang robot kecil merawat taman.', 'allow', true), false);
  assert.equal(shouldOfferWebToolToModel('Tidak, kami di kabupaten tetap normal, tapi tidak di KPU RI.', 'allow', true), false);
  assert.equal(shouldOfferWebToolToModel('Jangan cari web, jawab dari bobot saja.', 'allow', true), false);
  assert.equal(shouldOfferWebToolToModel('Apa yang kamu ingat tentang istriku?', 'allow', true), false);
  assert.equal(shouldOfferWebToolToModel('Siapa yang menyadap WA Presiden?', 'allow', true), true);
  assert.equal(shouldOfferWebToolToModel('Berita tentang istri Presiden', 'allow', true), true);
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

test('tool routing preserves normal conversation and streams the selected model answer in the same request', () => {
  assert.match(chatSource, /const shouldRunToolDecision = !visionImages\.length && !webSearchOptedOut/);
  assert.match(chatSource, /if \(shouldRunModelToolDecision\) \{/);
  assert.match(chatSource, /if \(shouldRunToolDecision && requestedWebDecision\.explicit\)/);
  assert.match(chatSource, /const shouldRunModelToolDecision = !visionImages\.length[\s\S]*?shouldOfferWebToolToModel\(message, requestBody\.value\.webPermission, hasSearchProvider\)[\s\S]*?!requestedWebDecision\.explicit/);
  assert.match(chatSource, /Gunakan tanggal dan waktu lokal pada konteks sistem/);
  assert.match(chatSource, /Jangan mencari hanya karena topik yang sama pernah dicari/);
  assert.match(chatSource, /\[ROUTER DAN JAWABAN STREAMING\]/);
  assert.match(chatSource, /pernyataan, koreksi, pengalaman langsung, informasi internal/);
  assert.match(chatSource, /const bufferUntilToolDecision = toolRounds === 0 && requestedWebDecision\.search/);
  assert.doesNotMatch(chatSource, /max_tokens: 320/);
  assert.match(chatSource, /await receiveProviderResponse\(result\.response, nativeCalls, bufferUntilToolDecision\)/);
  assert.match(chatSource, /answerReady = true/);
  assert.match(chatSource, /phase: 'replace'/);
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
