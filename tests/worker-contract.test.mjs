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
  assert.match(read('public/index.html'), /aai-crystal\.css/);
  assert.match(read('public/login.html'), /aai-mascot\.jpg/);
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
  assert.match(sw, /aai-shell-v18/);
  assert.match(sw, /url\.pathname\.startsWith\('\/assets\/'\)/);
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
