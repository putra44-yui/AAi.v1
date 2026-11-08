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

test('Companion micro-model endpoint is disabled by default without deleting its handler', () => {
  const worker = read('src/worker.ts');
  const wrangler = JSON.parse(read('wrangler.jsonc'));
  assert.match(worker, /import \{ handleCompanionMicro \}/);
  assert.match(worker, /AAI_COMPANION_ENABLED !== 'true'/);
  assert.match(worker, /return handleCompanionMicro\(request, env\)/);
  assert.equal(wrangler.vars.AAI_COMPANION_ENABLED, 'false');
  assert.equal(wrangler.previews.vars.AAI_COMPANION_ENABLED, 'false');
});

test('OpenRouter free-auto is explicitly opt-in, not an automatic fallback', () => {
  const server = read('src/chat.ts');
  const client = read('public/assets/js/app.js');
  assert.match(server, /DEFAULT_FREE_MODEL = 'openrouter\/free'/);
  assert.match(server, /modelPreference === 'free-auto'/);
  assert.match(client, /model_preference: currentModelPreference/);
  assert.doesNotMatch(server, /OPENROUTER_FALLBACK_MODEL/);
});

test('GLM 5.3 Flash is an explicit opt-in while Qwen Omni remains the default', () => {
  const server = read('src/chat.ts');
  const client = read('public/assets/js/app.js');
  assert.match(client, /val: 'main', label: '⚡ Qwen Omni Flash · utama'/);
  assert.match(client, /val: 'glm-5\.3-flash'/);
  assert.match(client, /savedModelPreference === 'free-auto' \|\| savedModelPreference === 'glm-5\.3-flash'/);
  assert.match(server, /modelPreference === 'glm-5\.3-flash'/);
  assert.match(server, /z-ai\/glm-5\.3-flash/);
  assert.match(server, /modelPreference === 'free-auto'/);
});

test('PWA precache references real files and prefers network for updated app code', () => {
  const sw = read('public/sw.js');
  const list = sw.match(/const PRECACHE_URLS = \[([\s\S]*?)\];/);
  assert.ok(list, 'Precache list must exist');
  for (const [, path] of list[1].matchAll(/'([^']+)'/g)) {
    assert.ok(existsSync(new URL(`../public${path}`, import.meta.url)), `Missing PWA asset: ${path}`);
  }
  assert.match(sw, /aai-shell-v[0-9]+/);
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

test('Markdown tables preserve columns and scroll horizontally', () => {
  const renderer = read('public/assets/js/app.js');
  const css = read('public/assets/css/aai-studio.css');
  assert.ok(renderer.includes('makeReadableMarkdownTables(compactExternalLinks(safeHtml))'));
  assert.ok(renderer.includes("table.classList.add('aai-data-table')"));
  assert.ok(renderer.includes("scroll.className = 'aai-table-scroll'"));
  assert.ok(renderer.includes("scroll.appendChild(table)"));
  assert.ok(css.includes('overflow-x:auto'));
  assert.ok(css.includes('width:max-content'));
  assert.ok(css.includes('nth-child(even)'));
});
test('AAi adapts emoji use to relaxed roleplay without altering formal output', () => {
  const context = read('src/aai-context.ts');
  assert.ok(context.includes('roleplay, atau saat pengguna memakai emoji'));
  assert.ok(context.includes('tidak wajib setiap balasan'));
  assert.ok(context.includes('Jangan menyisipkan emoji pada surat, notula, dokumen resmi'));
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
  assert.match(server, /tool_choice: toolChoice/);
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
test('AAi displays a compact evidence trail and readable named source links', () => {
  const client = read('public/assets/js/app.js');
  const css = read('public/assets/css/aai-studio.css');
  assert.match(client, /Penelusuran selesai/);
  assert.match(client, /saveActivityTrace\(parsed\.message_id/);
  assert.match(client, /buildStoredActivityPanelHTML\(messageId, extra\?\.activityTrace\)/);
  assert.match(client, /function compactExternalLinks/);
  assert.match(client, /link\.classList\.add\('aai-source-link'\)/);
  assert.match(css, /\.aai-source-link::after/);
  assert.match(css, /content: '↗'/);
});

test('router traces stay saved for audit without flooding phone screens', () => {
  const server = read('src/chat.ts');
  const client = read('public/assets/js/app.js');
  assert.match(server, /message: 'Menyiapkan jawaban\.\.\.'/);
  assert.match(server, /const activityStartedAt = requestStartedAt/);
  assert.match(server, /activity_trace: \{/);
  assert.match(server, /\.select\('id, role, content, parent_id, created_at, activity_trace'\)/);
  assert.match(client, /activityTrace: message\.activity_trace \|\| null/);
  assert.match(client, /const trace = persistedTrace/);
  assert.match(client, /getStoredActivityTraces\(\)\[messageId\]/);
});

test('AAi shows real search sources with favicons, and model reports without tool icons', () => {
  const server = read('src/chat.ts');
  const client = read('public/assets/js/app.js');
  const css = read('public/assets/css/aai-studio.css');
  assert.match(server, /step: 'sources', message: `Menemukan \$\{outcome\.sources\.length\} sumber\.`/);
  assert.match(server, /Menelusuri web/);
  assert.doesNotMatch(server, /Mencari sumber melalui Tavily|lanjut ke Exa/);
  assert.match(server, /sources: outcome\.sources\.slice\(0, 5\)\.map\(source =>/);
  assert.match(server, /source\.image \? \{ image: source\.image \}/);
  assert.match(client, /if \(step === 'sources'\)/);
  assert.match(client, /function publicActivityStep\(/);
  assert.match(client, /if \(step === 'tavily'\)/);
  assert.match(client, /if \(step === 'exa'\)/);
  assert.match(client, /if \(step === 'report'\)/);
  assert.match(client, /Ignore provider, memory count, tool decision, compose and model strategy/);
  assert.match(client, /renderActivitySourceHTML/);
  assert.match(client, /www\.google\.com\/s2\/favicons/);
  assert.match(client, /rel="noopener noreferrer nofollow"/);
  assert.match(css, /\.aai-activity-report/);
  assert.match(css, /\.aai-activity-source-link/);
  assert.match(client, /entry\?\.sources/);
  assert.match(client, /map\(renderActivitySourceHTML\)/);
  assert.match(client, /data-aai-favicon/);
  assert.match(client, /image\.complete && image\.naturalWidth === 0/);
  assert.match(client, /aai-source-thumb-placeholder/);
  assert.match(client, /aai-inline-source-icon/);
  assert.match(css, /overflow-x:\s*auto/);
  assert.match(css, /scroll-snap-type:\s*x proximity/);
  assert.match(css, /\.bubble a\.aai-source-link[\s\S]*inline-flex/);
});

test('AAi promotes model-generated opening text into the compact tool activity', () => {
  const server = read('src/chat.ts');
  const client = read('public/assets/js/app.js');
  const css = read('public/assets/css/aai-studio.css');
  assert.ok(server.includes("phase: 'tool_switch'"));
  assert.ok(server.includes("phase: 'progress'"));
  assert.ok(server.includes('Merangkum temuan dan menyusun jawaban'));
  assert.ok(client.includes("parsed.phase === 'tool_switch'"));
  assert.ok(client.includes('clearStreamingRenderSchedule()'));
  assert.ok(client.includes('renderActivityStepHTML'));
  assert.ok(client.includes('prefaceEl?.textContent'));
  assert.ok(client.includes('buildStoredActivityPanelHTML(messageId, extra?.activityTrace)'));
  assert.ok(css.includes('.aai-activity-step-icon'));
  assert.ok(css.includes('.aai-preface'));
});
test('a public preface remains visible while the details panel stays collapsed', () => {
  const client = read('public/assets/js/app.js');
  assert.match(client, /const activityHtml = `<p class="aai-preface"/);
  assert.match(client, /<details class="aai-activity" id="activity_/);
  assert.match(client, /data-started-at="\$\{Date\.now\(\)\}" hidden/);
  assert.match(client, /if \(prefaceEl && prefaceEl\.hidden\)/);
  assert.match(client, /if \(!rows\) return intro/);
  assert.doesNotMatch(client, /activityEl\.open = true/);
});

test('AAi asks the selected LLM to call a real tool or reply directly', () => {
  const server = read('src/chat.ts');
  const client = read('public/assets/js/app.js');
  assert.ok(server.includes('tools: [SEARCH_WEB_TOOL]'));
  assert.ok(server.includes("tool_choice: toolChoice"));
  assert.ok(server.includes('completedNativeToolCalls(nativeCalls)'));
  assert.ok(server.includes('answerReady = true'));
  assert.ok(server.includes("toolChoice = toolRounds === 0 && requestedWebDecision.explicit ? 'required' : 'auto'"));
  assert.ok(server.includes("const finalPayload: ProviderRequestBody"));
  assert.ok(!server.includes("tool_choice: 'none'"));
  assert.ok(server.includes("phase: 'tool_switch'"));
  assert.ok(!server.includes('generateAAiKnowledgeProbe'));
  assert.ok(client.includes("assess: 'fa-lightbulb'"));
  assert.ok(client.includes("strategy: 'fa-compass'"));
});
test('AAi streams safe text incrementally and formats settled Markdown blocks once', () => {
  const client = read('public/assets/js/app.js');
  const css = read('public/assets/css/aai-studio.css');
  assert.match(client, /function ensureStreamingMarkdownNode/);
  assert.match(client, /function findStableStreamMarkdownBoundary/);
  assert.match(client, /function prepareStreamingPlainText/);
  assert.match(client, /streamingMarkdownRenderer\.code/);
  assert.match(client, /requestAnimationFrame\(\(\) => \{/);
  assert.match(client, /lastNode\.appendData\(delta\)/);
  assert.match(client, /liveEl\.textContent = displayTail/);
  assert.match(client, /committedEl\.insertAdjacentHTML\('beforeend', formatContent\(pending\.slice\(0, boundary\)\)\)/);
  assert.match(client, /formatContent\(fullText\)/);
  assert.doesNotMatch(client, /STREAM_RENDER_INTERVAL_MS|STREAM_SCROLL_INTERVAL_MS/);
  assert.doesNotMatch(client, /liveEl\.innerHTML = tailText/);
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
  assert.match(server, /const shouldRunToolDecision = !hasVisionInput && !webSearchOptedOut/);
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
  assert.match(server, /while \(!streamCanceled && toolRounds < MAX_WEB_TOOL_ROUNDS/);
  assert.match(server, /toolChoice = toolRounds === 0 && requestedWebDecision\.explicit/);
  assert.doesNotMatch(server, /mustFinish|reachedLimit/);
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


test('web tool loop exits at the hard cap and final composition omits tool schema', () => {
  const server = read('src/chat.ts');
  assert.match(server, /while \(!streamCanceled && toolRounds < MAX_WEB_TOOL_ROUNDS/);
  assert.doesNotMatch(server, /toolRounds <= MAX_WEB_TOOL_ROUNDS/);
  const finalStart = server.indexOf('const finalPayload: ProviderRequestBody');
  const finalEnd = server.indexOf('const final = await fetchProviderStream', finalStart);
  assert.ok(finalStart >= 0 && finalEnd > finalStart);
  const finalBlock = server.slice(finalStart, finalEnd);
  assert.match(finalBlock, /temperature: 0\.45/);
  assert.doesNotMatch(finalBlock, /tools:\s*\[SEARCH_WEB_TOOL\]|tool_choice/);
  assert.match(server, /COBA LAGI.*Kirim jawaban teks final sekarang/s);
});

test('inline source citations blend with prose instead of rendering as buttons', () => {
  const css = read('public/assets/css/aai-studio.css');
  const index = read('public/index.html');
  const sw = read('public/sw.js');
  assert.match(css, /Inline citations: blend with assistant prose/);
  assert.ok(css.includes("font-size: .94em"));
  assert.ok(css.includes("background: transparent"));
  assert.match(css, /aai-inline-source-favicon/);
  assert.ok(index.includes("aai-studio.css?v=20261108-stream-render1"));
  assert.match(sw, /aai-shell-v[0-9]+/);
});

test('all three chat flows provide timezone to server current clock', () => {
  const client = read('public/assets/js/app.js');
  const server = read('src/chat.ts');
  const clock = read('src/aai-clock.ts');
  assert.ok(client.includes('function getAAiDeviceTimeZone()'));
  assert.equal(client.split('time_zone: getAAiDeviceTimeZone()').length - 1, 3);
  assert.ok(server.includes('normalizeAAiTimeZone(readTrimmedString(parsedValue.time_zone))'));
  assert.ok(server.includes('buildAAiClockContext(requestBody.value.timeZone, history.length === 0)'));
  assert.ok(clock.includes('DEFAULT_AAI_TIME_ZONE'));
});

test('Preview routes account APIs to a pinned backend version and fails closed without one', () => {
  const worker = read('src/worker.ts');
  const config = JSON.parse(read('wrangler.jsonc'));
  assert.equal(config.vars.AAI_ENVIRONMENT, 'production');
  assert.equal(config.previews.vars.AAI_ENVIRONMENT, 'preview');
  assert.match(config.previews.vars.AAI_PREVIEW_API_VERSION_ID, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  assert.deepEqual(config.previews.services, [{ binding: 'AAI_PRODUCTION_API', service: 'aai-v0' }]);
  assert.ok(worker.includes('AAI_PREVIEW_API_VERSION_ID'));
  assert.ok(worker.includes('Cloudflare-Workers-Version-Overrides'));
  assert.ok(worker.includes('env.AAI_PRODUCTION_API.fetch(new Request(request, { headers }))'));
  assert.ok(worker.includes("path.startsWith('/api/') && env.AAI_ENVIRONMENT === 'preview'"));
  assert.ok(worker.includes("api_backend: env.AAI_ENVIRONMENT === 'preview' ? 'preview-version-override' : 'local-worker'"));
  assert.ok(worker.includes("path === '/api/companion/reaction'"));
  assert.ok(worker.includes('Versi backend Preview belum dikonfigurasi'));
  assert.ok(worker.includes('Tidak ada request yang diteruskan ke backend produksi'));
});

test('web search chooses curated primary domains before widening to the general web', () => {
  const server = read('src/chat.ts');
  const web = read('src/aai-web.ts');
  const tool = read('src/aai-tools.ts');
  assert.ok(server.includes('resolveSourcePlan(message, query)'));
  assert.ok(server.includes('source_category: outcome.sourcePlan.id'));
  assert.ok(server.includes('broadened: outcome.broadened'));
  assert.ok(server.includes('searched_domains: outcome.sourcePlan.domains'));
  assert.ok(web.includes('include_domains: domains'));
  assert.ok(web.includes('includeDomains: domains'));
  assert.ok(web.includes('priorityDomains'));
  assert.ok(web.includes('relatedDomains'));
  assert.ok(web.includes('sourceMatchesDomains(source.url, domains)'));
  assert.ok(web.includes('normalizeWebSources(result?.results, 20)'));
  assert.ok(web.includes("scope === 'related'"));
  assert.ok(server.includes('priority_domains: outcome.sourcePlan.priorityDomains'));
  assert.ok(server.includes('related_domains: outcome.sourcePlan.relatedDomains'));
  assert.ok(tool.includes('memeriksa domain utama lebih dulu'));
});

test('Android debug APK workflow is manual-only until explicitly requested', () => {
  const workflow = read('.github/workflows/aai-companion-android.yml');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request):/m);
});
