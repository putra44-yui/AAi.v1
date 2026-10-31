import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

test('OSS free is explicitly opt-in, not an automatic fallback', () => {
  const server = read('src/chat.ts');
  const client = read('public/assets/js/app.js');
  assert.match(server, /DEFAULT_TEST_MODEL = 'openai\/gpt-oss-20b:free'/);
  assert.match(server, /modelPreference === 'oss-test'/);
  assert.match(client, /model_preference: currentModelPreference/);
  assert.doesNotMatch(server, /OPENROUTER_FALLBACK_MODEL/);
});
