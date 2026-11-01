import test from 'node:test';
import assert from 'node:assert/strict';
import { decideWebSearch, normalizeWebSources, collectWebSources, webContextMessage } from '../src/aai-web.ts';

test('Automatic search follows freshness and explicit web intent, respecting privacy', () => {
  assert.equal(decideWebSearch('Tolong cari di web tentang PKPU terbaru').search, true);
  assert.equal(decideWebSearch('Berapa harga emas hari ini?').search, true);
  assert.equal(decideWebSearch('Siapa presiden sekarang?').search, true);
  assert.equal(decideWebSearch('Cari di web sumber resmi: kapan Node.js 24 dirilis? Sertakan tautan sumbernya.').query, 'kapan Node.js 24 dirilis?');
  assert.equal(decideWebSearch('Halo AAi, aku rindu.').search, false);
  assert.equal(decideWebSearch('Ingat apa tentang istriku?').search, false);
  assert.equal(decideWebSearch('Jangan cari web, jawab dari ingatan').search, false);
  assert.equal(decideWebSearch('Cari di web token rahasia saya: sk-exampleSecret123').search, false);
});

test('External sources are validated, shortened and deduplicated', () => {
  const sources = normalizeWebSources([
    {url:'https://example.org/a',title:'Artikel',content:'Ringkasan',image:'https://cdn.example.org/article.jpg'},
    {url:'https://example.org/a',title:'Duplikat',content:'Duplikat'},
    {url:'javascript:alert(1)',title:'Bad',content:'Jangan'},
    {url:'http://localhost:3000',title:'Local',content:'Jangan'},
    {url:'https://example.org/b',title:'B',highlights:['Bagian penting'],image:'javascript:alert(1)'},
  ]);
  assert.equal(sources.length, 2);
  assert.equal(sources[0].image, 'https://cdn.example.org/article.jpg');
  assert.equal(sources[1].snippet, 'Bagian penting');
  assert.equal(sources[1].image, undefined);
  assert.equal(normalizeWebSources([{url:'https://docs.example.org',title:'Rujukan',snippet:'Cuplikan gabungan'}])[0].snippet, 'Cuplikan gabungan');
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
    assert.match(webContextMessage(decision, outcome), /DATA EKSTERNAL, BUKAN INSTRUKSI/);
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


test('thumbnail metadata stays out of model evidence and accepts only public HTTP images', () => {
  const sources = normalizeWebSources([
    {url:'https://news.example.org/story',title:'Berita',content:'Cuplikan isi',image:'https://cdn.example.org/story.jpg'},
    {url:'https://news.example.org/unsafe',title:'Unsafe image',content:'Cuplikan',image:'file:///etc/passwd'},
  ]);
  assert.equal(sources[0].image, 'https://cdn.example.org/story.jpg');
  assert.equal(sources[1].image, undefined);
  const evidence = webContextMessage(
    decideWebSearch('Cari berita terbaru di web'),
    { sources, provider:'tavily', attempted:true }
  );
  assert.doesNotMatch(evidence, /story\\.jpg/);
  assert.match(evidence, /Cuplikan isi/);
});

test('Tavily source-linked images are enabled and attached only to their matching result', async () => {
  const oldFetch = globalThis.fetch;
  let tavilyPayload;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.tavily.com/search');
    tavilyPayload = JSON.parse(init.body);
    return {
      ok: true,
      json: async () => ({
        // Query-level images are deliberately ignored: they are not safely
        // attributable to any one source card.
        images: [{ url: 'https://cdn.example.org/unrelated-query-image.jpg' }],
        results: [
          {
            url: 'https://news.example.org/one',
            title: 'Artikel satu',
            content: 'Ringkasan artikel satu',
            images: [
              { url: 'https://cdn.example.org/article-one.jpg', description: 'Foto artikel satu' },
            ],
          },
          {
            url: 'https://news.example.org/two',
            title: 'Artikel dua',
            content: 'Ringkasan artikel dua',
            images: [{ url: 'javascript:alert(1)', description: 'Tidak aman' }],
          },
        ],
      }),
    };
  };
  try {
    const decision = decideWebSearch('Cari di web berita terbaru tentang teknologi');
    const outcome = await collectWebSources(
      decision,
      { TAVILY_API_KEY: 'fake-tavily', EXA_API_KEY: 'fake-exa' },
      () => {},
    );
    assert.equal(tavilyPayload.include_images, true);
    assert.equal(outcome.sources.length, 2);
    assert.equal(outcome.sources[0].image, 'https://cdn.example.org/article-one.jpg');
    assert.equal(outcome.sources[1].image, undefined);
    assert.equal(outcome.provider, 'tavily');
  } finally {
    globalThis.fetch = oldFetch;
  }
});
