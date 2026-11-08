import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../public/assets/js/app.js', import.meta.url), 'utf8');

test('web app model menu uses the server model catalog instead of main/free aliases', () => {
  assert.match(app, /aai_model_selection/);
  assert.match(app, /async function loadAAiModelCatalog/);
  assert.match(app, /fetch\('\/api\/models'/);
  assert.match(app, /qwen\/qwen3\.8-flash/);
  assert.match(app, /qwen\/qwen3\.8-omni-flash/);
  assert.match(app, /z-ai\/glm-5\.3-flash/);
  assert.match(app, /function selectModelUI\(val\)[\s\S]*aaiModelCatalog\.some/);
  assert.doesNotMatch(app, /currentModelPreference/);
});

test('new chat, regeneration and edited branches all send the selected model ID', () => {
  assert.equal((app.match(/model_id: currentModelSelection/g) || []).length, 3);
});
