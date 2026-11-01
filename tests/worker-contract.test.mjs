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
  assert.match(sw, /aai-shell-v28/);
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


test('Native web search stays server-side and progress reflects real tool results', () => {
  const server = read('src/chat.ts');
  const client = read('public/assets/js/app.js');
  const web = read('src/aai-web.ts');
  const tools = read('src/aai-tools.ts');
  assert.match(server, /collectWebSources\(decision/);
  assert.match(server, /addNativeToolDeltas\(/);
  assert.match(server, /tool_choice: requestedWebDecision\.explicit \? 'required' : 'auto'/);
  assert.match(server, /role: 'tool'/);
  assert.match(server, /isAllowedPublicWebQuery\(message, query\)/);
  assert.match(tools, /name: 'search_web'/);
  assert.match(web, /env, 'TAVILY_API_KEY'/);
  assert.match(web, /env, 'EXA_API_KEY'/);
  const wrangler = JSON.parse(read('wrangler.jsonc'));
  assert.equal(wrangler.ratelimits[0].name, 'AAI_WEB_SEARCH_LIMITER');
  assert.match(server, /withinQuota/);
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

test('AAi promotes model-generated opening text into the compact tool activity', () => {
  const server = read('src/chat.ts');
  const client = read('public/assets/js/app.js');
  const css = read('public/assets/css/aai-studio.css');
  assert.ok(server.includes("phase: 'tool_switch'"));
  assert.ok(server.includes("phase: 'progress'"));
  assert.ok(server.includes('Menyusun jawaban dari hasil yang tersedia'));
  assert.ok(client.includes("parsed.phase === 'tool_switch'"));
  assert.ok(client.includes('clearStreamingRenderSchedule()'));
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

test('AAi asks the selected LLM to call a real tool or reply directly', () => {
  const server = read('src/chat.ts');
  const client = read('public/assets/js/app.js');
  assert.ok(server.includes('tools: [SEARCH_WEB_TOOL]'));
  assert.ok(server.includes("tool_choice: requestedWebDecision.explicit ? 'required' : 'auto'"));
  assert.ok(server.includes('completedNativeToolCalls(nativeCalls)'));
  assert.ok(server.includes('answerReady = true'));
  assert.ok(server.includes("tool_choice: 'none'"));
  assert.ok(server.includes("phase: 'tool_switch'"));
  assert.ok(!server.includes('generateAAiKnowledgeProbe'));
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

test('web tool permission is explicit, off by default, and enforced before tool exposure', () => {
  const client = read('public/assets/js/app.js');
  const html = read('public/index.html');
  const server = read('src/chat.ts');
  const policy = read('src/aai-web.ts');
  assert.match(client, /aai_web_tool_permission/);
  assert.match(client, /let currentWebPermission = localStorage\.getItem\('aai_web_tool_permission'\) === 'allow' \? 'allow' : 'deny'/);
  assert.equal((client.match(/web_permission: currentWebPermission/g) || []).length, 3);
  assert.match(html, /role="menuitemcheckbox" aria-checked="false"/);
  assert.match(html, /id="webPermissionBtn"/);
  assert.match(server, /webPermission: WebToolPermission/);
  assert.match(server, /parsedValue\.web_permission === 'allow' \? 'allow' : 'deny'/);
  assert.match(server, /if \(webPermissionGranted && !webSearchOptedOut && hasSearchProvider\)/);
  assert.match(server, /isAllowedPublicWebQuery\(message, query\)/);
  assert.match(policy, /export function isAllowedPublicWebQuery/);
});

test('AAi conversation depth is adaptive, not an answer-length quiz', () => {
  const prompt = read('src/aai-context.ts');
  assert.match(prompt, /Jangan memperlakukan percakapan seperti kuis/);
  assert.match(prompt, /untuk ajakan diskusi/);
  assert.match(prompt, /Jangan membatasi panjang jawaban secara kaku/);
  assert.doesNotMatch(prompt, /jawaban langsung ke inti, jelas, dan tidak berputar-putar/);
});

test('agent loop can make bounded, sequential model-selected web calls', () => {
  const server = read('src/chat.ts');
  assert.match(server, /MAX_WEB_TOOL_ROUNDS = 3/);
  assert.match(server, /while \(!streamCanceled && toolRounds <= MAX_WEB_TOOL_ROUNDS\)/);
  assert.match(server, /toolChoice = mustFinish \? 'none'/);
  assert.match(server, /const searchedQueries = new Set<string>\(\)/);
  assert.match(server, /searchedQueries\.has\(queryKey\)/);
  assert.match(server, /limiter\.limit\(\{ key: ip \}\)/);
  assert.match(server, /toolRounds \+= 1/);
  assert.match(server, /role: 'tool'/);
  assert.match(server, /phase: 'tool_switch'/);
});

test('family identity uses the linked account and speaks to the person directly', () => {
  const context = read('src/aai-context.ts');
  assert.match(context, /resolveAAiFamilyVoice\(user\.username/);
  assert.match(context, /SAPAAAN DAN PERSPEKTIF PEMBICARA/);
  assert.match(context, /berbicara LANGSUNG dengan Teguh Putra/);
  assert.match(context, /berbicara LANGSUNG dengan Rosalia/);
  assert.match(context, /slang Indonesia ringan/);
});
