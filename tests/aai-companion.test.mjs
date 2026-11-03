import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const core = require('../public/assets/js/aai-companion-core.js');
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('companion is a second view, with original mascot not generic stock or legacy JPG', () => {
  const html = read('public/index.html');
  const css = read('public/assets/css/aai-companion.css');
  const js = read('public/assets/js/aai-companion.js');
  assert.match(html, /id="aaiCompanionSwitch"/);
  assert.match(html, /id="aaiCompanionStage"/);
  assert.match(html, /id="aaiCompanionBubble"/);
  assert.match(html, /id="aaiCompanionMascot"/);
  assert.match(html, /src="\/aai-mascot-studio\.png"/);
  assert.match(html, /id="aaiCompanionPrev"/);
  assert.match(html, /id="aaiCompanionNext"/);
  assert.match(html, /id="aaiCompanionShowComposer"/);
  assert.match(js, /const key = 'aai_companion_prefs_v1_'/);
  assert.match(css, /aai-companion-active.*chat-area/);
  assert.doesNotMatch(js, /aai-mascot\.jpg|a-ai-rust\.vercel\.app/);
});

test('comic pages use previous / next inside one balloon and preserve complete answer for Chatbot', () => {
  const sample = 'Masalahnya bukan tools. Riwayat itu ada, tetapi disimpan di sesi lain. '
    + 'Kita membutuhkan pencarian yang aman ke riwayat akun sendiri. '
    + 'Pencarian umum di web tidak bisa membaca pesan pribadi.';
  const pages = core.paginateSpeech(sample, 65);
  assert.ok(pages.length >= 3);
  assert.ok(pages.every(page => page.length > 0 && Array.from(page).length <= 65));
  assert.ok(pages.join(' ').includes('Masalahnya bukan tools.'));
  assert.ok(pages.join(' ').includes('Riwayat itu ada'));
  assert.ok(!pages.some(page => page.endsWith('riwaya')));
});

test('long words, emoji, and markdown are safe to show as text', () => {
  const pages = core.paginateSpeech('😳✨ Halo AAi. ' + 'superpanjang'.repeat(80), 55);
  assert.ok(pages.length >= 5);
  assert.ok(pages.every(x => Array.from(x).length <= 55));
  assert.equal(core.speechPlainText('**Hai** [tautan](https://private.example)'),
    'Hai tautan');
  assert.ok(core.speechPlainText('<img src=x onerror=evil()>').includes('Konten lengkap'));
});

test('gestures distinguish drag, tap and long press', () => {
  const p = { x:20, y:20 };
  assert.equal(core.classifyGesture(p,{x:23,y:25},100),'tap');
  assert.equal(core.classifyGesture(p,{x:20,y:21},601),'long-press');
  assert.equal(core.classifyGesture(p,{x:58,y:49},300),'drag');
  assert.deepEqual(core.clampPosition(-4,999,300,200),{x:0,y:200});
});

test('reactions rotate instead of repeating recent responses, with no LLM required for visual feedback', () => {
  const a = core.reactionFor('head',[],0);
  const b = core.reactionFor('head',[a],0);
  assert.notEqual(a,b);
  assert.match(a,/kepala|rambut/i);
  assert.match(core.reactionFor('protect',[],0),/malu/i);
  const source=read('public/assets/js/aai-companion.js');
  assert.match(source,/function reactToTouch/);
  assert.match(source,/const local=core\.reactionFor\(zone,state\.recent\)/);
  assert.match(source,/mascot\.addEventListener\('pointermove'/);
  assert.match(source,/aaiCompanionBridge/);
  assert.match(source,/state\.alphaMap=null/);
});

test('new view is bound to existing SSE, never starts another chat API request', () => {
  const source=read('public/assets/js/app.js');
  const companion=read('public/assets/js/aai-companion.js');
  assert.match(source,/companionEvent\('begin'/);
  assert.match(source,/companionEvent\('token', \{ token: parsed\.token \}\)/);
  assert.match(source,/companionEvent\('done', \{ text: fullText \}\)/);
  assert.match(source,/companionEvent\('error'\)/);
  assert.doesNotMatch(companion,/fetch\(['"]\/api\/chat/);
  assert.doesNotMatch(companion,/console\.log\(.*(?:currentUser|fullText|token)/);
});

test('Android legacy Vercel app must not be treated as the Companion production frontend', () => {
  const decision=read('docs/plans/2026-11-03-aai-dual-mode-chatbot-companion.md');
  assert.match(decision,/ARSIP LAWAS — JANGAN DITIRU/);
  assert.match(decision,/kristal bertuliskan AAi/);
});
