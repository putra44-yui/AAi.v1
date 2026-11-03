import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import {
  decideWebSearch, hasWebSearchOptOut, shouldRunWebToolDecision,
} from '../src/aai-web.ts';

test('conversational explicit web commands are recognized without seeing exact "cari web"', () => {
  for (const prompt of ['BOAT coba cari dulu', 'coba cari dulu', 'cari lagi', 'coba cari tentang BOAT', 'cek dulu di web', 'Cari web', 'carikan sumber resmi Ronaldo BOAT']) {
    const decision = decideWebSearch(prompt);
    assert.equal(decision.search, true, prompt);
    assert.equal(decision.explicit, true, prompt);
  }
});
test('no-web commands override web words and non-web creative prompts stay direct', () => {
  for (const prompt of ['Jangan cari web Ronaldo', 'tanpa web, jawab dari bobot saja', 'jangan cari dulu', 'cari ide cerita fantasi', 'mencari kerja remote']) {
    const decision = decideWebSearch(prompt);
    assert.equal(decision.search, false, prompt);
  }
  assert.equal(hasWebSearchOptOut('jangan cari web'), true);
});
test('permission stays separate from request and provider', () => {
  const decision = decideWebSearch('BOAT coba cari dulu');
  assert.equal(shouldRunWebToolDecision(decision, 'deny', true), false);
  assert.equal(shouldRunWebToolDecision(decision, 'allow', false), false);
  assert.equal(shouldRunWebToolDecision(decision, 'allow', true), true);
});

const script = readFileSync(new URL('../public/assets/js/app.js', import.meta.url), 'utf8');
const start = script.indexOf('function publicActivityStep(');
const end = script.indexOf('const pendingActivityClocks', start);
assert.ok(start >= 0 && end > start, 'public activity projection must exist');
const ui = runInNewContext(script.slice(start, end) + ';({ publicActivityStep, renderActivityStepHTML, buildStoredActivityPanelHTML })', {
  escHtml: value => String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  AAI_ACTIVITY_STEP_ICONS: {
    tavily: 'fa-search', exa: 'fa-globe', found: 'fa-book-open',
    sources: 'fa-book-open', report: 'fa-comment', unavailable: 'fa-exclamation-circle',
  },
  renderActivitySourceHTML: () => '<a>source</a>',
  formatActivityDuration: () => '8s',
  getStoredActivityTraces: () => ({}),
});

test('the family never sees router internals, including old saved traces', () => {
  const internals = [
    ['assess', 'Menyiapkan jawaban...'],
    ['memory', 'Mengingat 14 catatan konteks percakapan...'],
    ['provider', 'Model terhubung; menunggu kata pertama...'],
    ['compose', 'Menghubungi model untuk menyiapkan jawaban...'],
    ['strategy', 'Memeriksa apakah perlu mencari informasi...'],
  ];
  for (const [step, message] of internals) {
    assert.equal(ui.publicActivityStep({ step, message }), null, step);
    assert.equal(ui.renderActivityStepHTML({ step, message }), '', step);
  }
  const stored = ui.buildStoredActivityPanelHTML('fixture-message', {
    durationMs: 8000, steps: internals.map(([step, message]) => ({ step, message })),
  });
  assert.equal(stored, '', 'router-only activity should disappear after reload');
});
test('real searches show short public steps and source links stay expandable', () => {
  const trace = {
    durationMs: 8000,
    steps: [
      { step: 'assess', message: 'Memeriksa apakah perlu mencari informasi' },
      { step: 'tavily', message: 'Mencari sumber dari web' },
      { step: 'found', message: 'Menemukan 5 sumber. Meninjau isinya' },
      { step: 'sources', message: 'Menemukan 5 sumber', sources: [{ url: 'https://example.org', title: 'Verified source' }] },
      { step: 'provider', message: 'Model terhubung; menunggu kata pertama...' },
    ],
  };
  const panel = ui.buildStoredActivityPanelHTML('fixture-message', trace);
  assert.match(panel, /Penelusuran selesai/);
  assert.match(panel, /Menelusuri web/);
  assert.match(panel, /Ketemu 5 sumber/);
  assert.match(panel, /source/);
  assert.doesNotMatch(panel, /Model terhubung|Menyiapkan jawaban|Memeriksa apakah perlu/);
  assert.doesNotMatch(panel, /<details[^>]*\sopen/);
});
test('a real second-search report is allowed without exposing raw model strategy', () => {
  const intro = ui.publicActivityStep({ step:'report', message:'Aku coba cari pembandingnya dulu, ya.' });
  assert.equal(intro.message, 'Aku coba cari pembandingnya dulu, ya.');
  assert.equal(ui.publicActivityStep({ step:'strategy', message:'Hidden deliberation' }), null);
});
