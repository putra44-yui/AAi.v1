import test from 'node:test';
import assert from 'node:assert/strict';
import { decideWebSearch, normalizeWebSources, collectWebSources, webContextMessage } from '../src/aai-web.ts';

test('Automatic search follows freshness and explicit web intent, respecting privacy', () => {
  assert.equal(decideWebSearch('Tolong cari di web tentang PKPU terbaru').search, true);
  assert.equal(decideWebSearch('Berapa harga emas hari ini?').search, true);
  assert.equal(decideWebSearch('Siapa presiden sekarang?').search, true);
  assert.equal(decideWebSearch('Halo AAi, aku rindu.').search, false);
  assert.equal(decideWebSearch('Ingat apa tentang istriku?').search, false);
  assert.equal(decideWebSearch('Jangan cari web, jawab dari ingatan').search, false);
  assert.equal(decideWebSearch('Cari di web token rahasia saya: sk-exampleSecret123').search, false);
});

test('External sources are validated, shortened and deduplicated', () => {
  const sources = normalizeWebSources([
    {url:'https://example.org/a',title:'Artikel',content:'Ringkasan'},
    {url:'https://example.org/a',title:'Duplikat',content:'Duplikat'},
    {url:'javascript:alert(1)',title:'Bad',content:'Jangan'},
    {url:'http://localhost:3000',title:'Local',content:'Jangan'},
    {url:'https://example.org/b',title:'B',highlights:['Bagian penting']},
  ]);
  assert.equal(sources.length, 2);
  assert.equal(sources[1].snippet, 'Bagian penting');
});

test('Tavily is first; Exa runs only if initial results are insufficient', async () => {
  const oldFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('tavily')) return { ok: true, json: async () => ({results:[]}) };
    return { ok: true, json: async () => ({results:[{url:'https://docs.example.org',title:'Rujukan',highlights:['Valid']} ]}) };
  };
  try {
    const steps = [];
    const decision = decideWebSearch('Cari di web berita terbaru hari ini');
    const outcome = await collectWebSources(decision, {TAVILY_API_KEY:'fake-tavily',EXA_API_KEY:'fake-exa'}, (step) => steps.push(step));
    assert.deepEqual(calls, ['https://api.tavily.com/search','https://api.exa.ai/search']);
    assert.equal(outcome.provider, 'exa');
    assert.deepEqual(steps, ['tavily','exa','found']);
    assert.match(webContextMessage(decision, outcome), /DATA EKSTERNAL TIDAK TEPERCAYA/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('No external API call for an offline or private query', async () => {
  const result = await collectWebSources(decideWebSearch('Cerita tentang anakku'), {TAVILY_API_KEY:'fake'}, () => {
    throw new Error('Should not search');
  });
  assert.equal(result.attempted, false);
  assert.equal(result.sources.length, 0);
});
