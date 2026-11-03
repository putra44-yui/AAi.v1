import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const webSource = readFileSync(new URL('../src/aai-web.ts', import.meta.url), 'utf8');
const webModule = ts.transpileModule(webSource, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { decideWebSearch, shouldRunWebToolDecision } = await import(
  'data:text/javascript;base64,' + Buffer.from(webModule).toString('base64')
);

const chatSource = readFileSync(new URL('../src/chat.ts', import.meta.url), 'utf8');

test('ordinary and private requests use the direct streamed reply when web is enabled', () => {
  const messages = [
    'Halo AAi, kamu lagi apa?',
    'Buat cerita enam paragraf tentang robot kecil merawat taman.',
    'Jelaskan dengan sederhana cara kerja kompas dalam enam paragraf.',
    'Aku pulang kerja dan Ayaka minta bermain, bagaimana ya?',
  ];
  for (const message of messages) {
    assert.equal(shouldRunWebToolDecision(decideWebSearch(message), 'allow', true), false, message);
  }
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
  assert.match(chatSource, /if \(shouldRunToolDecision\) \{/);
  assert.match(chatSource, /\[KEPUTUSAN TOOL SAJA\]/);
  assert.match(chatSource, /max_tokens: 320/);
  assert.match(chatSource, /await receiveProviderResponse\(result\.response, nativeCalls, true\)/);
  assert.match(chatSource, /replyParts\.length = 0;\s*emittedTokenCount = 0;\s*displayFilter = createAAiMemoryStreamFilter\(\);/);
  assert.doesNotMatch(chatSource, /displayFilter\.push\(candidate\)/);
  assert.match(chatSource, /await receiveProviderResponse\(final\.response\)/);
  assert.match(chatSource, /const finalPayload: ProviderRequestBody = \{[\s\S]*?messages: finalMessages/);
});

test('tool failure never silently turns an explicit search into an unverified answer', () => {
  assert.match(chatSource, /toolChoice === 'required'/);
  assert.match(chatSource, /failUnexecutedSearch\('Model mengirim teks tanpa memanggil alat pencarian/);
  assert.match(chatSource, /isAllowedPublicWebQuery\(message, query\)/);
  assert.match(chatSource, /upstreamAbortController\.abort\(\)/);
  assert.match(chatSource, /\[PENCARIAN TIDAK TERSEDIA\]/);
});
