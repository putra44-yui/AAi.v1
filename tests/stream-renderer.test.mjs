import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/assets/js/app.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../public/assets/css/aai-studio.css', import.meta.url), 'utf8');
const page = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('streaming renders on the next animation frame without a fixed 105 ms throttle', () => {
  assert.ok(app.includes('function scheduleStreamingRender() {'));
  assert.ok(app.includes('renderFrame = requestAnimationFrame(() => {'));
  assert.ok(!/STREAM_RENDER_INTERVAL_MS|STREAM_SCROLL_INTERVAL_MS|renderTimer|lastRenderAt/.test(app));
});

test('unfinished text is appended safely while completed Markdown blocks are formatted once', () => {
  assert.ok(app.includes("committedEl.insertAdjacentHTML('beforeend', formatContent(pending.slice(0, boundary)))"));
  assert.ok(app.includes('const displayTail = prepareStreamingPlainText(tailText)'));
  assert.ok(app.includes('liveEl.textContent = displayTail'));
  assert.ok(app.includes('lastNode.appendData(delta)'));
  assert.ok(!app.includes('liveEl.innerHTML = tailText ? formatContent'));
});

test('internal streaming markers are hidden until complete and never injected as HTML', () => {
  assert.ok(app.includes('function prepareStreamingPlainText(text)'));
  assert.ok(app.includes('value.lastIndexOf(marker)'));
  assert.ok(app.includes('Teman baru terdeteksi'));
  assert.ok(app.includes('document.createTextNode(delta)'));
});

test('streaming scroll is immediate and justified text is restored after completion', () => {
  assert.ok(app.includes('function scheduleStreamScroll(force = false) {\n    scrollBottom(force);'));
  assert.ok(styles.includes('.chat-area.is-streaming {\n  scroll-behavior: auto !important;'));
  assert.ok(styles.includes('.chat-area.is-streaming .msg-row.assistant .bubble'));
  assert.ok(app.includes("chatArea?.classList.remove('is-streaming')"));
  assert.ok(app.includes("document.getElementById('chatArea')?.classList.remove('is-streaming')"));
});

test('the page loads the versioned renderer and stylesheet', () => {
  assert.ok(page.includes('aai-studio.css?v=20261109-mobile-model2'));
  assert.ok(page.includes('app.js?v=20261109-mobile-model2'));
});
