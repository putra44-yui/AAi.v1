import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const app = readFileSync(new URL('../public/assets/js/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/assets/css/aai-studio.css', import.meta.url), 'utf8');

function snippet(start, end) {
  const begin = app.indexOf(start);
  const finish = app.indexOf(end, begin + start.length);
  assert.ok(begin >= 0 && finish > begin, `${start} must be present before ${end}`);
  return app.slice(begin, finish);
}

test('session title focuses on substantive subject instead of UX test instructions', () => {
  const getTitle = runInNewContext(
    snippet('function buildSessionFallbackTitle(', 'function isProvisionalSessionTitle(') + '\nbuildTopicSessionTitle;',
  );
  assert.equal(getTitle('UJI UX, jangan cari web. Buat tabel Markdown empat kolom tentang HTML, CSS, JavaScript, dan TypeScript.'),
    'HTML CSS JavaScript TypeScript');
  assert.match(getTitle('Jelaskan kerja kompas secara sederhana.'), /kompas/i);
});

test('internal public activity report remains safe for audits without appearing in the chat UI', () => {
  const getReport = runInNewContext(
    snippet('function parsePublicSourceUrl(', 'function collectActivitySources(')
      + snippet('function createPublicActivityReport(', 'function buildActivityLiveHTML(')
      + '\ncreatePublicActivityReport;',
    { URL },
  );
  const report = getReport({
    completed: true, durationMs: 15200, firstTokenMs: 12900,
    steps: [
      { step: 'strategy', atMs: 250, message: 'private opening fixture' },
      { step: 'sources', atMs: 6400, message: 'Menemukan 1 sumber.', sources: [{
        url: 'https://developers.cloudflare.com/workers/runtime-apis/streams/',
        title: 'Streams', snippet: 'secret-in-snippet', image: 'https://example.com/secret-thumbnail',
      }] },
    ],
  });
  assert.equal(report.schema, 'aai.public_activity.v1');
  assert.equal(report.first_token_ms, 12900);
  assert.equal(report.duration_ms, 15200);
  assert.equal(report.steps[0].message, 'Model memberikan pembuka publik.');
  assert.equal(report.steps[1].at_ms, 6400);
  assert.equal(report.steps[1].sources[0].title, 'Streams');
  assert.doesNotMatch(JSON.stringify(report), /private opening|secret-in-snippet|secret-thumbnail/);
});

test('activity shows factual streaming milestones, not the raw JSON log', () => {
  const getLiveHTML = runInNewContext(
    snippet('function buildActivityLiveHTML(', 'const AAI_ACTIVITY_STEP_ICONS')
      + '\nbuildActivityLiveHTML;',
    { escHtml: text => String(text).replaceAll('&', '&amp;').replaceAll('"', '&quot;') },
  );
  const html = getLiveHTML('trace_test');
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /activity_live_trace_test/);
  assert.match(html, /Menghubungkan ke AAi/);
  assert.doesNotMatch(app, /JSON aktivitas|aai-activity-json|activity_json_/);
  assert.match(app, /Jawaban sedang ditulis, sedikit demi sedikit/);
  assert.match(app, /updateActivityLive\(parsed\.step === 'tavily'/);
  assert.match(css, /aai-activity-live-dot/);
  assert.match(css, /prefers-reduced-motion/);
});

test('documentation cards use a restrained icon while visual articles retain thumbnails', () => {
  const render = runInNewContext(
    snippet('function parsePublicSourceUrl(', 'function collectActivitySources(')
      + snippet('function renderMessageSourceCardHTML(', 'function buildMessageSourcePreviewHTML(')
      + '\nrenderMessageSourceCardHTML;',
    { URL, escHtml: text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;') },
  );
  const docs = render({ url: 'https://developers.cloudflare.com/workers/', title: 'Workers docs',
    image: 'https://example.com/giant-logo.jpg', snippet: 'A guide to Workers' });
  assert.match(docs, /is-documentation/);
  assert.match(docs, /Dokumentasi/);
  assert.doesNotMatch(docs, /giant-logo\.jpg/);
  const article = render({ url: 'https://example.org/articles/river', title: 'River article',
    image: 'https://example.org/river.jpg', snippet: 'A river with a blue sky.' });
  assert.match(article, /river\.jpg/);
  assert.match(article, /has-thumbnail/);
});

test('mobile text avoids justification and controls have accessible names', () => {
  assert.match(css, /Inter-word justification causes visible rivers/);
  assert.match(css, /\.msg-row\.assistant > \.bubble :is\(p,li,blockquote\)/);
  assert.match(css, /text-align: left/);
  assert.match(app, /aria-label="Salin jawaban"/);
  assert.match(app, /aria-label="Ulangi jawaban"/);
  assert.match(app, /aria-label="Dengarkan jawaban"/);
  assert.match(app, /buildActivityLiveHTML\(streamId\)/);
});
