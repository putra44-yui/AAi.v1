import test from 'node:test';
import assert from 'node:assert/strict';
import { decideWebSearch, resolveSourcePlan, normalizeWebSources, collectWebSources, webContextMessage } from '../src/aai-web.ts';

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

test('Source registry selects primary domains based on the question topic', () => {
  const election = resolveSourcePlan('Cari PKPU Nomor 4 Tahun 2024 di web', 'PKPU Nomor 4 Tahun 2024');
  assert.equal(election.id, 'kpu-election');
  assert.ok(election.domains.includes('jdih.kpu.go.id'));
  assert.ok(election.domains.includes('peraturan.bpk.go.id'));

  const pbj = resolveSourcePlan('Cari aturan PBJ dan swakelola terbaru', 'LKPP swakelola');
  assert.equal(pbj.id, 'procurement');
  assert.ok(pbj.domains.includes('jdih.lkpp.go.id'));

  const cloudflare = resolveSourcePlan('Bagaimana konfigurasi Cloudflare Workers?', 'Cloudflare Workers configuration');
  assert.equal(cloudflare.id, 'cloudflare');
  assert.ok(cloudflare.domains.includes('developers.cloudflare.com'));

  const node = resolveSourcePlan('Cek dokumentasi Node.js terbaru', 'Node.js documentation');
  assert.equal(node.id, 'nodejs');
  assert.ok(node.domains.includes('nodejs.org'));

  const paper = resolveSourcePlan('Cari paper benchmark model bahasa', 'benchmark model bahasa');
  assert.equal(paper.id, 'research');
  assert.ok(paper.domains.includes('arxiv.org'));

  const electionNews = resolveSourcePlan('Cari berita terbaru tentang KPU', 'berita KPU terbaru');
  assert.equal(electionNews.id, 'kpu-election');
  assert.ok(electionNews.categories.includes('kpu-election'));
  assert.ok(electionNews.categories.includes('news'));
  assert.ok(electionNews.priorityDomains.includes('jdih.kpu.go.id'));
  assert.ok(electionNews.priorityDomains.includes('kompas.com'));

  const qwenResearch = resolveSourcePlan('Cari riset Qwen terbaru', 'paper Qwen');
  assert.equal(qwenResearch.id, 'research');
  assert.ok(qwenResearch.categories.includes('research'));
  assert.ok(qwenResearch.categories.includes('qwen'));
  assert.ok(qwenResearch.priorityDomains.includes('arxiv.org'));
  assert.ok(qwenResearch.priorityDomains.includes('qwen.ai'));

  const englishWho = resolveSourcePlan('Who is the current CEO?', 'Who is the current CEO?');
  assert.equal(englishWho.id, 'general', 'The English word "who" must not route to public health');

  const general = resolveSourcePlan('Cari tren teknologi terbaru', 'tren teknologi terbaru');
  assert.equal(general.id, 'general');
  assert.deepEqual(general.domains, []);
});

test('Domain search checks priority sources first, filters before truncation, then checks related domains', async () => {
  const oldFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const payload = JSON.parse(init.body);
    calls.push({ url: String(url), payload });
    if (String(url).includes('tavily') && payload.include_domains?.includes('jdih.kpu.go.id')) {
      return { ok: true, json: async () => ({ results: [
        { url: 'https://random-blog.example/one', title: 'Blog satu', content: 'Di luar domain' },
        { url: 'https://random-blog.example/two', title: 'Blog dua', content: 'Di luar domain' },
        { url: 'https://random-blog.example/three', title: 'Blog tiga', content: 'Di luar domain' },
        { url: 'https://random-blog.example/four', title: 'Blog empat', content: 'Di luar domain' },
        { url: 'https://random-blog.example/five', title: 'Blog lima', content: 'Di luar domain' },
        { url: 'https://jdih.kpu.go.id/produk-hukum/one', title: 'Dokumen KPU', content: 'Sumber resmi KPU' },
      ] }) };
    }
    if (String(url).includes('exa')) {
      return { ok: true, json: async () => ({ results: [] }) };
    }
    if (String(url).includes('tavily') && payload.include_domains?.includes('bawaslu.go.id')) {
      return { ok: true, json: async () => ({ results: [
        { url: 'https://peraturan.bpk.go.id/Details/one', title: 'Peraturan BPK', content: 'Pembanding peraturan' },
        { url: 'https://bawaslu.go.id/berita/one', title: 'Bawaslu', content: 'Rujukan terkait' },
        { url: 'https://random-blog.example/six', title: 'Blog enam', content: 'Di luar domain' },
      ] }) };
    }
    return { ok: true, json: async () => ({ results: [] }) };
  };
  try {
    const decision = { search: true, query: 'PKPU Nomor 4 Tahun 2024', explicit: true };
    const plan = resolveSourcePlan('Cari PKPU Nomor 4 Tahun 2024 di web', decision.query);
    const steps = [];
    const outcome = await collectWebSources(
      decision,
      { TAVILY_API_KEY: 'fake-tavily', EXA_API_KEY: 'fake-exa' },
      (step, count, message) => steps.push({ step, count, message }),
      undefined,
      plan,
    );

    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map(call => call.url), [
      'https://api.tavily.com/search',
      'https://api.exa.ai/search',
      'https://api.tavily.com/search',
    ]);
    assert.equal(calls[0].payload.max_results, 10);
    assert.ok(calls[0].payload.include_domains.includes('jdih.kpu.go.id'));
    assert.equal(calls[1].payload.numResults, 10);
    assert.ok(calls[1].payload.includeDomains.includes('jdih.kpu.go.id'));
    assert.ok(calls[2].payload.include_domains.includes('bawaslu.go.id'));
    assert.ok(calls[2].payload.include_domains.includes('peraturan.bpk.go.id'));
    assert.ok(!calls[2].payload.include_domains.includes('jdih.kpu.go.id'));

    assert.equal(outcome.sourcePlan.id, 'kpu-election');
    assert.deepEqual(outcome.attempts.map(attempt => attempt.scope), ['priority', 'priority', 'related']);
    assert.equal(outcome.broadened, true);
    assert.equal(outcome.attempts.length, 3);
    assert.equal(outcome.sources.length, 3);
    assert.ok(outcome.sources.some(source => source.url.includes('jdih.kpu.go.id')));
    assert.ok(outcome.sources.some(source => source.url.includes('peraturan.bpk.go.id')));
    assert.ok(outcome.sources.some(source => source.url.includes('bawaslu.go.id')));
    assert.ok(!outcome.sources.some(source => source.url.includes('random-blog.example')));
    assert.ok(steps.some(step => step.step === 'report' && /situs rujukan terkait/i.test(step.message)));
    assert.ok(steps.some(step => step.step === 'found' && step.count === 3));
  } finally {
    globalThis.fetch = oldFetch;
  }
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
  assert.equal(normalizeWebSources(Array.from({ length: 8 }, (_, index) => ({
    url: 'https://limit.example/' + index, title: 'Source ' + index, content: 'Text',
  }))).length, 5, 'The default result cap remains five');
  assert.equal(normalizeWebSources(Array.from({ length: 8 }, (_, index) => ({
    url: 'https://limit.example/' + index, title: 'Source ' + index, content: 'Text',
  })), 8).length, 8, 'Provider filtering can inspect more than five results');
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
    const decision = decideWebSearch('Cari di web tren teknologi terbaru');
    const outcome = await collectWebSources(decision, {TAVILY_API_KEY:'fake-tavily',EXA_API_KEY:'fake-exa'}, (step) => steps.push(step));
    assert.deepEqual(calls, ['https://api.tavily.com/search','https://api.exa.ai/search']);
    assert.equal(outcome.provider, 'exa');
    assert.deepEqual(steps, ['tavily','exa','found']);
    assert.match(webContextMessage(decision, outcome), /DATA EKSTERNAL, BUKAN INSTRUKSI/);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('A failed targeted search gives the model an honest, auditable limitation', async () => {
  const decision = { search: true, query: 'PKPU Nomor 99 Tahun 2099', explicit: true };
  const sourcePlan = resolveSourcePlan('Cari PKPU Nomor 99 Tahun 2099', decision.query);
  const context = webContextMessage(decision, {
    sources: [],
    provider: null,
    attempted: true,
    sourcePlan,
    attempts: [
      { provider: 'tavily', scope: 'priority', domains: sourcePlan.priorityDomains, sourceCount: 0 },
      { provider: 'exa', scope: 'priority', domains: sourcePlan.priorityDomains, sourceCount: 0 },
      { provider: 'tavily', scope: 'related', domains: sourcePlan.relatedDomains, sourceCount: 0 },
    ],
    broadened: true,
  });
  assert.match(context, /Domain utama yang diperiksa/);
  assert.match(context, /domain rujukan terkait/);
  assert.match(context, /tavily \(priority, 0 hasil\)/);
  assert.match(context, /tidak menghasilkan sumber yang lolos pemeriksaan/);
  assert.doesNotMatch(context, /mengaku telah menemukan informasi terbaru/);
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
    decideWebSearch('Cari tren teknologi terbaru di web'),
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
              { url: 'javascript:alert(1)', description: 'Tidak aman' },
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
    const decision = decideWebSearch('Cari di web tren teknologi terbaru');
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

test('Enough primary-domain results stop early without paying for an unnecessary Exa or broad search', async () => {
  const oldFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), payload: JSON.parse(init.body) });
    return {
      ok: true,
      json: async () => ({ results: [
        { url: 'https://jdih.kpu.go.id/produk-hukum/one', title: 'Dokumen KPU', content: 'Sumber primer satu' },
        { url: 'https://peraturan.bpk.go.id/Details/two', title: 'Peraturan BPK', content: 'Sumber primer dua' },
      ] }),
    };
  };
  try {
    const decision = { search: true, query: 'PKPU Nomor 4 Tahun 2024', explicit: true };
    const plan = resolveSourcePlan('Cari PKPU Nomor 4 Tahun 2024', decision.query);
    const outcome = await collectWebSources(
      decision,
      { TAVILY_API_KEY: 'fake-tavily', EXA_API_KEY: 'fake-exa' },
      () => {},
      undefined,
      plan,
    );
    assert.equal(calls.length, 1);
    assert.ok(calls[0].payload.include_domains.includes('jdih.kpu.go.id'));
    assert.equal(outcome.sources.length, 2);
    assert.equal(outcome.broadened, false);
    assert.deepEqual(outcome.attempts, [{
      provider: 'tavily',
      scope: 'priority',
      domains: plan.priorityDomains,
      sourceCount: 2,
    }]);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
