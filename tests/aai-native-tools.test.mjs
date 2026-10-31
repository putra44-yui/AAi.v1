import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const source = readFileSync(new URL('../src/aai-tools.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { SEARCH_WEB_TOOL, addNativeToolDeltas, completedNativeToolCalls, extractSearchWebQuery } = await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
);

test('native tool schema keeps the model on a narrow public search tool', () => {
  assert.equal(SEARCH_WEB_TOOL.type, 'function');
  assert.equal(SEARCH_WEB_TOOL.function.name, 'search_web');
  assert.deepEqual(SEARCH_WEB_TOOL.function.parameters.required, ['query']);
  assert.equal(SEARCH_WEB_TOOL.function.parameters.additionalProperties, false);
});

test('OpenRouter streamed tool-call fragments are accumulated and parsed', () => {
  const pending = new Map();
  addNativeToolDeltas(pending, [{ index: 0, id: 'call_abc', type: 'function', function: { name: 'search_', arguments: '{"que' } }]);
  addNativeToolDeltas(pending, [{ index: 0, function: { name: 'web', arguments: 'ry":"Node.js 24' } }]);
  addNativeToolDeltas(pending, [{ index: 0, function: { arguments: ' release date"}' } }]);
  const calls = completedNativeToolCalls(pending);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].function.name, 'search_web');
  assert.equal(extractSearchWebQuery(calls[0]), 'Node.js 24 release date');
});

test('malformed, unsupported, and oversized tool arguments never produce a query', () => {
  const base = { id: 'call_x', type: 'function', function: { name: 'search_web', arguments: '' } };
  for (const args of ['not-json', '{}', '{"query":1}', '{"query":"ok"}', '{"query":"okay","extra":true}', '{"query":"' + 'x'.repeat(300) + '"}']) {
    assert.equal(extractSearchWebQuery({ ...base, function: { ...base.function, arguments: args } }), null);
  }
  assert.equal(extractSearchWebQuery({ ...base, function: { name: 'delete_file', arguments: '{"query":"Node.js"}' } }), null);
  assert.deepEqual(completedNativeToolCalls(new Map()), []);
});
