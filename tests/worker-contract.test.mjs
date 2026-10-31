import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

test('Cloudflare replaces the Next build and keeps static files', () => {
  const pkg = JSON.parse(read('package.json'));
  const wrangler = JSON.parse(read('wrangler.jsonc'));
  assert.equal(pkg.dependencies.next, undefined);
  assert.match(pkg.scripts.build, /wrangler deploy --dry-run/);
  assert.equal(wrangler.main, 'src/worker.ts');
  assert.equal(wrangler.assets.directory, './public');
  assert.ok(wrangler.assets.run_worker_first.includes('/api/*'));
  assert.match(read('public/index.html'), /aai-studio\.css/);
  assert.match(read('public/login.html'), /aai-mascot-studio\.png/);
});

test('essential API routes still have Worker handlers', () => {
  const worker = read('src/worker.ts');
  for (const route of ['/api/chat', '/api/login', '/api/sessions', '/api/messages', '/api/file-jobs', '/api/planning-memory', '/api/friends/detect-and-suggest', '/api/friends/confirm-and-save']) {
    assert.ok(worker.includes(route), `Missing route: ${route}`);
  }
  assert.match(worker, /Konfigurasi Supabase belum tersedia/);
});

test('OpenRouter free-auto is explicitly opt-in, not an automatic fallback', () => {
  const server = read('src/chat.ts');
  const client = read('public/assets/js/app.js');
  assert.match(server, /DEFAULT_FREE_MODEL = 'openrouter\/free'/);
  assert.match(server, /modelPreference === 'free-auto'/);
  assert.match(client, /model_preference: currentModelPreference/);
  assert.doesNotMatch(server, /OPENROUTER_FALLBACK_MODEL/);
});

test('PWA precache references real files and prefers network for updated app code', () => {
  const sw = read('public/sw.js');
  const list = sw.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/);
  assert.ok(list, 'Precache list must exist');
  for (const [, path] of list[1].matchAll(/'([^']+)'/g)) {
    assert.ok(existsSync(new URL(`../public${path}`, import.meta.url)), `Missing PWA asset: ${path}`);
  }
  assert.match(sw, /aai-shell-v25/);
  assert.match(sw, /pathname\.startsWith\('\/assets\/'\)/);
});

test('login alias does not redirect back to Cloudflare canonical login URL', () => {
  const worker = read('src/worker.ts');
  const wrangler = JSON.parse(read('wrangler.jsonc'));
  assert.ok(wrangler.assets.run_worker_first.includes('/login'));
  assert.doesNotMatch(worker, /Response\.redirect/);
  assert.match(worker, /return env\.ASSETS\.fetch\(request\)/);
});

test('restored session title prefers a real title over provisional loading text', () => {
  const client = read('public/assets/js/app.js');
  assert.match(client, /const latestSession = sessions\.find\(item => item\.id === normalizedId\)/);
  assert.match(client, /\.find\(value => !isProvisionalSessionTitle\(value\)\) \|\| buildSessionTitleFromMessages\(data\.messages\)/);
  assert.doesNotMatch(client, /title: session\?\.title \|\| titleHint \|\| buildSessionTitleFromMessages/);
});

test('legacy memory and file endpoints receive runtime Supabase bindings', () => {
  const worker = read('src/worker.ts');
  assert.match(worker, /runtimeEnv: \{ SUPABASE_URL:/);
  assert.match(worker, /runLegacy\(request, route, env\)/);
  for (const name of [
    'api_backup/planning-memory.js', 'api_backup/planning-memory/[id].js',
    'api_backup/friends/detect-and-suggest.js',
    'api_backup/friends/confirm-and-save.js', 'api_backup/file-jobs.js',
  ]) {
    const handler = read(name);
    assert.match(handler, /const supabase = runtimeClient\(req\);/);
    assert.doesNotMatch(handler, /const supabase = createClient\(\s*process\.env/);
  }
});

test('wide Markdown responses are labeled cards and do not shrink to five tiny columns', () => {
  const renderer = read('public/assets/js/app.js');
  const css = read('public/assets/css/aai-studio.css');
  assert.match(renderer, /makeReadableMarkdownTables\(compactExternalLinks\(safeHtml\)\)/);
  assert.match(renderer, /headings\.length < 4/);
  assert.match(renderer, /cell\.setAttribute\('data-label'/);
  assert.match(css, /table\.aai-table-cards tbody/);
  assert.match(css, /content: attr\(data-label\)/);
});

test('root edits skip nonexistent parent validation', () => {
  const source = read('src/chat.ts');
  assert.match(source, /if \(parentId\) \{\s*const \{ data: parent, error \}/);
  assert.doesNotMatch(source, /else \{\s*const \{ data: parent, error \}/);
});


test('Web search is server-side and progress is tied to actual results', () => {
  const server = read('src/chat.ts');
  const client = read('public/assets/js/app.js');
  const web = read('src/aai-web.ts');
  assert.match(server, /collectWebSources\(webDecision/);
  assert.match(server, /phase: 'progress'/);
  assert.match(web, /env, 'TAVILY_API_KEY'/);
  assert.match(web, /env, 'EXA_API_KEY'/);
  const wrangler = JSON.parse(read('wrangler.jsonc'));
  assert.equal(wrangler.ratelimits[0].name, 'AAI_WEB_SEARCH_LIMITER');
  assert.match(server, /webSearchAllowed/);
  assert.doesNotMatch(client, /TAVILY_API_KEY|EXA_API_KEY/);
  assert.match(client, /parsed\.phase === 'progress'/);
  assert.doesNotMatch(client, /Persona AI/);
});

test('AAi displays measured collapsible activity and readable named source links', () => {
  const client = read('public/assets/js/app.js');
  const css = read('public/assets/css/aai-studio.css');
  assert.match(client, /Memproses selama /);
  assert.match(client, /saveActivityTrace\(parsed\.message_id/);
  assert.match(client, /buildStoredActivityPanelHTML\(messageId\)/);
  assert.match(client, /function compactExternalLinks/);
  assert.match(client, /link\.classList\.add\('aai-source-link'\)/);
  assert.match(css, /\.aai-source-link::after/);
  assert.match(css, /content: '↗'/);
});

test('AAi streams an honest preface, icon steps, and an automatically saved summary', () => {
  const server = read('src/chat.ts');
  const client = read('public/assets/js/app.js');
  const css = read('public/assets/css/aai-studio.css');
  assert.ok(server.includes("phase: 'preface'"), 'Server must send a preface before tool work');
  assert.ok(server.includes("phase: 'progress'"), 'Server must stream real milestones');
  assert.ok(server.includes('Merangkum sumber dan menyusun jawaban'));
  assert.ok(client.includes("parsed.phase === 'preface'"));
  assert.ok(client.includes('renderActivityStepHTML'));
  assert.ok(client.includes('prefaceEl?.textContent'));
  assert.ok(client.includes('buildStoredActivityPanelHTML(messageId)'));
  assert.ok(css.includes('.aai-activity-step-icon'));
  assert.ok(css.includes('.aai-preface'));
});

test('AAi keeps the preface inside the collapsible activity, not outside the answer', () => {
  const client = read('public/assets/js/app.js');
  assert.ok(client.includes('return `<details class="aai-activity is-complete aai-saved-activity">'));
  const storedPanel = client.indexOf('return `<details class="aai-activity is-complete aai-saved-activity">');
  const introInside = client.indexOf('${intro}', storedPanel);
  const listInside = client.indexOf('<ul class="aai-activity-list">', introInside);
  assert.ok(storedPanel >= 0 && introInside > storedPanel && listInside > introInside);
  assert.ok(client.includes('<p class="aai-preface" id="preface_${streamId}" hidden></p>'));
  assert.ok(!client.includes('return intro + `<details'));
  assert.ok(!client.includes('>Sebentar, aku cek dulu, ya. ✨</p>'));
});

test('AAi asks its selected LLM for tentative knowledge before web tool evidence', () => {
  const server = read('src/chat.ts');
  const client = read('public/assets/js/app.js');
  assert.ok(server.includes('async function generateAAiKnowledgeProbe('));
  assert.ok(server.includes('max_tokens: 200'));
  assert.ok(server.includes('message: probe.initial'));
  assert.ok(server.includes("step: 'assess'"));
  assert.ok(server.includes("step: 'strategy'"));
  assert.ok(server.includes('if (webDecision.search && webSearchAllowed)'));
  assert.ok(!server.includes('const preface = webDecision.search'));
  assert.ok(client.includes("assess: 'fa-lightbulb'"));
  assert.ok(client.includes("strategy: 'fa-compass'"));
});

test('AAi streams sanitized Markdown without reprocessing settled blocks', () => {
  const client = read('public/assets/js/app.js');
  const css = read('public/assets/css/aai-studio.css');
  assert.match(client, /function ensureStreamingMarkdownNode/);
  assert.match(client, /function findStableStreamMarkdownBoundary/);
  assert.match(client, /formatContent\(tailText, \{ streaming: true \}\)/);
  assert.match(client, /streamingMarkdownRenderer\.code/);
  assert.match(client, /const STREAM_RENDER_INTERVAL_MS = 105;/);
  assert.doesNotMatch(client, /streamingNode\.textContent \+= nextChunk/);
  assert.match(css, /\.aai-streaming-committed/);
  const source = client.match(/function findStableStreamMarkdownBoundary\(text\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source, 'Missing stable Markdown boundary parser');
  const boundary = new Function(source + '\nreturn findStableStreamMarkdownBoundary;')();
  assert.equal(boundary('**Halo**\n\nLanjut'), 10);
  assert.equal(boundary('```js\nconst x = 1;\n\nconst y = 2;\n'), 0, 'Never split an unclosed code fence');
  assert.equal(boundary('```js\nconst x = 1;\n```\n\nTeks'), 24);
});
