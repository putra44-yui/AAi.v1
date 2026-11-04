import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseVisionFiles, buildVisionContent, VISION_MAX_IMAGES } from '../src/aai-vision.ts';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lXr0AAAAASUVORK5CYII=';
const data = 'data:image/png;base64,' + PNG;
const image = { name:'small-screenshot.png', type:'image/png', base64:data };

test('valid PNG becomes an OpenRouter image_url part after the text prompt', () => {
  const result = parseVisionFiles([image]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.images.length, 1);
  const content = buildVisionContent('Apa tulisan pada screenshot?', result.images);
  assert.deepEqual(content[0], { type:'text', text:'Apa tulisan pada screenshot?' });
  assert.deepEqual(content[1], { type:'image_url', image_url:{ url:data } });
  assert.equal(buildVisionContent('Teks biasa', []), 'Teks biasa');
});

test('image-only chat and no-file requests have deterministic parsing', () => {
  assert.deepEqual(parseVisionFiles(undefined), {ok:true,images:[]});
  assert.deepEqual(parseVisionFiles([]), {ok:true,images:[]});
  assert.equal(parseVisionFiles('not-an-array').ok, false);
});

test('reject unsupported formats, MIME spoof, malformed data and oversized image count', () => {
  for (const item of [
    {name:'script.svg',type:'image/svg+xml',base64:'data:image/svg+xml;base64,'+PNG},
    {name:'fake.png',type:'image/png',base64:'data:image/png;base64,'+Buffer.from('not really PNG').toString('base64')},
    {name:'fake.jpg',type:'image/jpeg',base64:data},
    {name:'huge.png',type:'image/png',base64:'data:image/png;base64,'+'A'.repeat(5_600_000)},
    {name:'bad.png',type:'image/png',base64:'data:image/png;base64,not base64!!!'},
  ]) assert.equal(parseVisionFiles([item]).ok, false, item.name);
  assert.equal(parseVisionFiles(Array(VISION_MAX_IMAGES + 1).fill(image)).ok, false);
});

test('the chat handler never sends images to web search or permanent memory', () => {
  const server = readFileSync(new URL('../src/chat.ts', import.meta.url), 'utf8');
  assert.match(server, /visionImages\.length\s*\?\s*\(readEnv\('OPENROUTER_VISION_MODEL'/);
  assert.match(server, /buildVisionContent\(message, visionImages\)/);
  assert.match(server, /shouldRunToolDecision = !visionImages\.length && !webSearchOptedOut/);
  assert.match(server, /if \(!visionImages\.length && !verifiedHistoryUserId\) \{[\s\S]*?await persistAAiMemory/);
  assert.match(server, /content: input\.persistedMessage/);
  assert.match(server, /gambar tidak disimpan di riwayat/);
  assert.doesNotMatch(server, /console\.(?:log|info|warn)\(.*(?:base64|dataUrl)/);
});

test('mobile composer sends only allowed metadata and image data to API', () => {
  const client = readFileSync(new URL('../public/assets/js/app.js', import.meta.url), 'utf8');
  assert.match(client, /selectedFiles\.map\(prepareAAiImage\)/);
  assert.match(client, /files: files\.map\(f => \(\{ name: f\.name, type: f\.type, base64: f\.base64 \}\)\)/);
  assert.match(client, /Tolong jelaskan gambar yang kulampirkan/);
  assert.match(client, /resizeAAiImage|prepareAAiImage/);
  assert.match(client, /if \(step === 'vision'\)/);
  assert.match(client, /preview \|\| f\.base64/);
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp"/);
});
