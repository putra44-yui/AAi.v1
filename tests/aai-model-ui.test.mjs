import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/assets/js/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/assets/css/aai-studio.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

test('web app model menu uses the server model catalog instead of main/free aliases', () => {
  assert.match(app, /aai_model_selection/);
  assert.match(app, /async function loadAAiModelCatalog/);
  assert.match(app, /fetch\('\/api\/models'/);
  assert.match(app, /qwen\/qwen3\.8-flash/);
  assert.match(app, /qwen\/qwen3\.8-omni-flash/);
  assert.match(app, /z-ai\/glm-5\.3-flash/);
  assert.match(app, /function selectModelUI\(val\)[\s\S]*aaiModelCatalog\.some/);
  assert.doesNotMatch(app, /currentModelPreference/);
  assert.match(app, /function buildAssistantHeaderHTML\(versionHtml, modelName = '', modelLabel = ''\)/);
  assert.match(app, /assistant-model-tag/);
  assert.match(app, /buildAssistantHeaderHTML\(versionHtml, modelName, modelLabel\)/);
});

test('new chat, regeneration and edited branches all send the selected model ID', () => {
  assert.equal((app.match(/model_id: currentModelSelection/g) || []).length, 3);
});

test('mobile model picker is visible, labeled, and touch-friendly', () => {
  assert.match(app, /modeLabel\.textContent = 'Model · ' \+ shortLabel/);
  assert.match(app, /aria-expanded/);
  assert.match(html, /aria-controls="settingsMenu" aria-expanded="false"/);
  assert.match(html, /fa-microchip/);
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*?\.aai-top-settings \.mode-label \{[\s\S]*?position: static/);
  assert.match(css, /\.aai-top-settings \.settings-item \{[\s\S]*?min-height: 48px/);
});

test('PWA refreshes the mobile model picker assets instead of reusing the old shell cache', () => {
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /aai-shell-v38/);
  assert.match(sw, /aai-studio\.css\?v=20261109-mobile-model1/);
  assert.match(sw, /app\.js\?v=20261109-mobile-model1/);
  assert.match(html, /aai-studio\.css\?v=20261109-mobile-model1/);
  assert.match(html, /app\.js\?v=20261109-mobile-model1/);
});
