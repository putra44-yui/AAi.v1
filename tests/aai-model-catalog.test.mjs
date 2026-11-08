import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/model-catalog.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const catalog = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

test('Auto defaults to Qwen 3.8 Flash', () => {
  assert.equal(catalog.DEFAULT_MODEL_ID, 'qwen/qwen3.8-flash');
  assert.equal(catalog.resolveModelSelection('auto'), 'qwen/qwen3.8-flash');
});

test('the public model catalog exposes only the supported choices', () => {
  const result = catalog.getPublicModelCatalog();
  assert.equal(result.default_selection, 'auto');
  assert.deepEqual(result.models.map((model) => model.id), [
    'auto',
    'qwen/qwen3.8-omni-flash',
    'z-ai/glm-5.3-flash',
  ]);
  assert.ok(result.models.every((model) => !model.model_id.toLowerCase().includes('openai/')));
});

test('model selection accepts supported IDs and rejects unknown or expensive providers', () => {
  assert.deepEqual(catalog.parseModelSelection('auto'), { ok: true, value: 'auto' });
  assert.deepEqual(catalog.parseModelSelection('qwen/qwen3.8-omni-flash'), {
    ok: true,
    value: 'qwen/qwen3.8-omni-flash',
  });
  assert.deepEqual(catalog.parseModelSelection('z-ai/glm-5.3-flash'), {
    ok: true,
    value: 'z-ai/glm-5.3-flash',
  });
  assert.deepEqual(catalog.parseModelSelection(undefined), { ok: true, value: null });
  assert.deepEqual(catalog.parseModelSelection('openai/gpt-oss-20b:free'), { ok: false });
  assert.deepEqual(catalog.parseModelSelection('arbitrary/model'), { ok: false });
});

test('manual model selections resolve to the exact allowlisted provider IDs', () => {
  assert.equal(catalog.resolveModelSelection('qwen/qwen3.8-omni-flash'), 'qwen/qwen3.8-omni-flash');
  assert.equal(catalog.resolveModelSelection('z-ai/glm-5.3-flash'), 'z-ai/glm-5.3-flash');
});
