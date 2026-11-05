import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
  assert.match(source,/AAiCompanionBridge/);
  assert.match(source,/state\.alphaMap\s*=\s*null/);
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

test('native overlay draft is consumed only when WebView is ready and user owner matches', () => {
  const main = read('android/app/src/main/java/app/aai/capacitor/MainActivity.java');
  const plugin = read('android/app/src/main/java/app/aai/capacitor/AAiCompanionPlugin.java');
  const service = read('android/app/src/main/java/app/aai/capacitor/CompanionOverlayService.java');
  const client = read('public/assets/js/aai-companion.js');
  assert.match(main, /pendingDraftOwner/);
  assert.match(main, /pendingDraftAt/);
  assert.doesNotMatch(main, /postDelayed\(\(\)\s*->/);
  assert.match(plugin, /public void consumeDraft\(PluginCall call\)/);
  assert.match(plugin, /owner\.equals\(draftOwner\)/);
  assert.match(plugin, /age < 600000L/);
  assert.match(service, /AAI_COMPANION_OWNER/);
  assert.match(client, /await nativePlugin\.show\(\{showComposer:prefs\.composer,ownerId\}\)/);
  assert.match(client, /await nativePlugin\.consumeDraft\(\{userId:ownerId\}\)/);
  assert.match(client, /acceptNativeDraft\(draft\)/);
  assert.doesNotMatch(client, /nativePlugin\.send\(/);
});

test('Android Gradle does not retain passwords, signing keys, or developer Windows JAVA_HOME', () => {
  const gradle = read('android/gradle.properties');
  assert.doesNotMatch(gradle, /^\s*(?:AAI_RELEASE_(?:STORE_PASSWORD|KEY_PASSWORD|STORE_FILE|KEY_ALIAS)|org\.gradle\.java\.home)\s*=/m);
  const cap = JSON.parse(read('capacitor.config.json'));
  assert.equal(cap.server.url, 'https://aai-v0.aai-agents-yuiputra44.workers.dev');
  assert.doesNotMatch(JSON.stringify(cap), /a-ai-rust\.vercel\.app/);
});

test('actual canonical PNG remains pixel-identity-locked and uses RGBA (not a stock replacement)', () => {
  const png=readFileSync(new URL('../public/aai-mascot-studio.png',import.meta.url));
  assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  assert.equal(png.readUInt32BE(16),1230);
  assert.equal(png.readUInt32BE(20),1278);
  assert.equal(png[25],6,'PNG must have RGBA color type for transparent mascot');
  const blob=createHash('sha1')
    .update(Buffer.from('blob '+png.length)).update(Buffer.from([0]))
    .update(png).digest('hex');
  assert.equal(blob,'03ecbf99299936270dfdd465ade49e84500fe777');
});

test('transparent pixels do not trigger mascot reactions in browser or Android', () => {
  const web=read('public/assets/js/aai-companion.js');
  const native=read('android/app/src/main/java/app/aai/capacitor/CompanionOverlayService.java');
  assert.match(web, /const sample=state\.alphaMap\.ctx\.getImageData/);
  assert.match(web, /if\(sample\[3\]<35\) return null/);
  assert.match(web, /drawnH=img\.naturalHeight\*scale/);
  assert.match(native, /private float hitVisibleSprite\(MotionEvent event\)/);
  assert.match(native, /Color\.alpha\(canonicalSprite\.getPixel\(x,y\)\)<35/);
  assert.match(native, /if\(hitVisibleSprite\(event\)<0\) return false/);
});

test('native overlay Send uses the existing WebView session and waits for HTTP acceptance', () => {
  const service=read('android/app/src/main/java/app/aai/capacitor/CompanionOverlayService.java');
  const plugin=read('android/app/src/main/java/app/aai/capacitor/AAiCompanionPlugin.java');
  const web=read('public/assets/js/app.js');
  const companion=read('public/assets/js/aai-companion.js');
  const composer=service.split('private void createBottomComposer() {')[1]
    ?.split('private void updateComposerVisibility() {')[0] || '';
  assert.match(composer, /send\.setText\("↑"\)/);
  assert.match(composer, /AAiCompanionPlugin\.offerOverlaySend\(overlayOwnerId,requestId,draft\)/);
  assert.doesNotMatch(composer, /startActivity\(/, 'Send must not open a second Chatbot');
  assert.match(service, /ACTION_SEND_ACK/);
  assert.match(service, /pendingOverlayRequestId\.equals\(intent\.getStringExtra\("requestId"\)\)/);
  assert.match(service, /pendingOverlayDraft\.equals\(composerInput\.getText\(\)\.toString\(\)\.trim\(\)\)/);
  assert.match(service, /Periksa riwayat sebelum mencoba lagi/);
  assert.match(plugin, /notifyListeners\("overlaySend", payload\)/);
  assert.match(plugin, /public void setSendChannel\(PluginCall call\)/);
  assert.match(plugin, /public void acknowledgeSend\(PluginCall call\)/);
  assert.match(companion, /await nativePlugin\.addListener\('overlaySend'/);
  assert.match(companion, /await nativePlugin\.setSendChannel\(\{ownerId\}\)/);
  assert.match(companion, /await nativePlugin\.acknowledgeSend\(\{ownerId,requestId,accepted\}\)/);
  assert.match(companion, /await window\.AAiSendFromOverlay\?\.\(text,ownerId\)/);
  assert.match(web, /window\.AAiSendFromOverlay = function/);
  assert.match(web, /currentUser\.id!==ownerId/);
  assert.match(web, /onRequestAccepted:\s*\(\)\s*=>\s*acknowledge\(true\)/);
  assert.match(web, /onRequestRejected:\s*\(\)\s*=>\s*acknowledge\(false\)/);
  assert.match(web, /await fetch\('\/api\/chat'/);
  assert.doesNotMatch(plugin, /SUPABASE_SERVICE_ROLE|OPENROUTER_API_KEY/);
  assert.doesNotMatch(service, /SUPABASE_SERVICE_ROLE|OPENROUTER_API_KEY/);
});

test('native touch reaction restores the latest live answer without overriding composer settings', () => {
  const service=read('android/app/src/main/java/app/aai/capacitor/CompanionOverlayService.java');
  const companion=read('public/assets/js/aai-companion.js');
  const reaction=service.split('private void onMascotTap(float relativeY) {')[1]
    ?.split('private void createBottomComposer() {')[0] || '';
  assert.doesNotMatch(reaction, /composerVisible=true/);
  assert.doesNotMatch(reaction, /streaming=false/);
  assert.match(service, /latestModelText = text/);
  assert.match(service, /setPages\(latestModelText\)/);
  assert.match(service, /sendHandler\.postDelayed\(reactionRestore, 1800L\)/);
  assert.match(companion, /if\(document\.hidden\)nativeBubbleUpdate\(\)/);
});
