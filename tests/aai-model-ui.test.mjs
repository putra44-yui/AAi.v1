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

test('model picker stays icon-only in the header while choices remain named in its menu', () => {
  const labelUpdater = app.slice(app.indexOf('function updateModeLabel()'), app.indexOf('function updateCompactStatus'));
  assert.match(html, /aria-label="Pilih model AI" aria-controls="settingsMenu"/);
  assert.match(html, /fa-microchip/);
  assert.doesNotMatch(html, /id="modeLabel"|Model ·|Omni|GLM/);
  assert.doesNotMatch(labelUpdater, /modeLabel|selected\.label|Auto|Omni|GLM/);
  assert.match(labelUpdater, /aria-label', 'Pilih model AI'/);
  assert.match(app, /escHtml\(model\.label\)/);
  const mobile = css.slice(css.lastIndexOf('/* Mobile model picker: keep the header control icon-only. */'));
  assert.match(mobile, /\.aai-top-settings \.settings-btn \{[\s\S]*?width: 40px;[\s\S]*?min-width: 40px/);
  assert.doesNotMatch(mobile, /\.mode-label/);
  assert.match(css, /\.aai-top-settings \.settings-item \{[\s\S]*?min-height: 48px/);
  assert.match(app, /aria-expanded/);
});

test('PWA refreshes the mobile model picker assets instead of reusing the old shell cache', () => {
  const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  assert.match(sw, /aai-shell-v39/);
  assert.match(sw, /aai-studio\.css\?v=20261109-mobile-model2/);
  assert.match(sw, /app\.js\?v=20261109-mobile-model2/);
  assert.match(html, /aai-studio\.css\?v=20261109-mobile-model2/);
  assert.match(html, /app\.js\?v=20261109-mobile-model2/);
});
