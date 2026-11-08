import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/assets/js/app.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../public/assets/css/aai-studio.css', import.meta.url), 'utf8');
const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('streaming renders on the next animation frame without a fixed 105 ms throttle', () => {
  assert.match(app, /function scheduleStreamingRender\\(\\) \\{[\\s\\S]*?renderFrame = requestAnimationFrame\\(/);
  assert.doesNotMatch(app, /STREAM_RENDER_INTERVAL_MS|STREAM_SCROLL_INTERVAL_MS|renderTimer|lastRenderAt/);
});

test('unfinished text is appended safely while completed Markdown blocks are formatted once', () => {
  assert.match(app, /committedEl\\.insertAdjacentHTML\\('beforeend', formatContent\\(pending\\.slice\\(0, boundary\\)\\)\\)/);
  assert.match(app, /const displayTail = prepareStreamingPlainText\\(tailText\\)/);
  assert.match(app, /liveEl\\.textContent = displayTail/);
  assert.match(app, /lastNode\\.appendData\\(delta\\)/);
  assert.doesNotMatch(app, /liveEl\\.innerHTML = tailText \\? formatContent/);
});

test('internal streaming markers are hidden until complete and never injected as HTML', () => {
  assert.match(app, /function prepareStreamingPlainText\\(text\\)/);
  assert.match(app, /value\\.lastIndexOf\\(marker\\)/);
  assert.match(app, /replace\\(\\/\\\\\\[SUGGEST-FRIEND:/);
  assert.match(app, /document\\.createTextNode\\(delta\\)/);
});

test('streaming scroll is immediate and justified text is restored after completion', () => {
  assert.match(app, /function scheduleStreamScroll\\(force = false\\) \\{\\s*scrollBottom\\(force\\);\\s*\\}/);
  assert.match(styles, /\\.chat-area\\.is-streaming\\s*\\{[^}]*scroll-behavior:\\s*auto/);
  assert.match(styles, /\\.chat-area\\.is-streaming \\.msg-row\\.assistant \\.bubble/);
  assert.match(app, /chatArea\\?\\.classList\\.remove\\('is-streaming'\\)/);
  assert.match(app, /document\\.getElementById\\('chatArea'\\)\\?\\.classList\\.remove\\('is-streaming'\\)/);
});

test('the page loads the versioned renderer and stylesheet', () => {
  assert.match(page, /aai-studio\\.css\\?v=20261108-stream-render1/);
  assert.match(page, /app\\.js\\?v=20261108-stream-render1/);
});
