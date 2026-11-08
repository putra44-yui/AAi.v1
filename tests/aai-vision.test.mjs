import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMediaFiles, buildVisionContent, VISION_MAX_IMAGES } from '../src/aai-vision.ts';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lXr0AAAAASUVORK5CYII=';
const imageData = 'data:image/png;base64,' + PNG;
const image = { name:'small-screenshot.png', type:'image/png', base64:imageData };
const mp4Bytes = Buffer.alloc(16);
mp4Bytes.writeUInt32BE(16, 0);
mp4Bytes.write('ftyp', 4, 'ascii');
mp4Bytes.write('isom', 8, 'ascii');
const videoData = 'data:video/mp4;base64,' + mp4Bytes.toString('base64');
const video = { name:'clip.mp4', type:'video/mp4', base64:videoData };

test('valid PNG and MP4 become OpenRouter image_url and video_url parts', () => {
  const result = parseMediaFiles([image, video]);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.images.length, 1);
  assert.equal(result.videos.length, 1);
  const content = buildVisionContent('Apa isi lampiran ini?', result.images, result.videos);
  assert.deepEqual(content[0], { type:'text', text:'Apa isi lampiran ini?' });
  assert.deepEqual(content[1], { type:'image_url', image_url:{ url:imageData } });
  assert.deepEqual(content[2], { type:'video_url', video_url:{ url:videoData } });
  assert.equal(buildVisionContent('Teks biasa', [], []), 'Teks biasa');
});

test('image-only, video-only and no-file requests parse deterministically', () => {
  assert.deepEqual(parseMediaFiles(undefined), {ok:true,images:[],videos:[]});
  assert.deepEqual(parseMediaFiles([]), {ok:true,images:[],videos:[]});
  assert.equal(parseMediaFiles([image]).ok, true);
  assert.equal(parseMediaFiles([video]).ok, true);
  assert.equal(parseMediaFiles('not-an-array').ok, false);
});

test('reject unsupported formats, MIME spoof, malformed data and oversized counts', () => {
  for (const item of [
    {name:'script.svg',type:'image/svg+xml',base64:'data:image/svg+xml;base64,'+PNG},
    {name:'fake.png',type:'image/png',base64:'data:image/png;base64,'+Buffer.from('not really PNG').toString('base64')},
    {name:'fake.jpg',type:'image/jpeg',base64:imageData},
    {name:'bad.png',type:'image/png',base64:'data:image/png;base64,not base64!!!'},
    {name:'fake.mp4',type:'video/mp4',base64:imageData},
    {name:'fake.webm',type:'video/webm',base64:videoData},
  ]) assert.equal(parseMediaFiles([item]).ok, false, item.name);
  assert.equal(parseMediaFiles(Array(VISION_MAX_IMAGES + 1).fill(image)).ok, false);
  assert.equal(parseMediaFiles([video, video]).ok, false);
});

test('the chat handler keeps media out of web search, permanent memory and database payloads', () => {
  const server = readFileSync(new URL('../src/chat.ts', import.meta.url), 'utf8');
  assert.match(server, /modelPreference === 'glm-5\.3-flash'[\s\S]*?z-ai\/glm-5\.3-flash/);
  assert.match(server, /buildVisionContent\(message, visionImages, visionVideos\)/);
  assert.match(server, /const shouldRunToolDecision = !hasVisionInput && !webSearchOptedOut/);
  assert.match(server, /if \(!hasVisionInput\) \{\s*await persistAAiMemory/);
  assert.match(server, /content: input\.persistedMessage/);
  assert.match(server, /video tidak disimpan di riwayat/);
  assert.doesNotMatch(server, /console\.(?:log|info|warn)\(.*(?:base64|dataUrl)/);
});

test('model menu and composer expose GLM and MP4 only as an explicit opt-in', () => {
  const client = readFileSync(new URL('../public/assets/js/app.js', import.meta.url), 'utf8');
  assert.match(client, /val: 'glm-5\.3-flash'/);
  assert.match(client, /currentModelPreference !== 'glm-5\.3-flash'/);
  assert.match(client, /selectedFiles\.map\(prepareAAiMedia\)/);
  assert.match(client, /files: files\.map\(f => \(\{ name: f\.name, type: f\.type, base64: f\.base64 \}\)\)/);
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp,video\/mp4"/);
});
