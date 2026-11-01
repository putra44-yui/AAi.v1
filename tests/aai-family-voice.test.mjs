import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

// Verify family identity mapping using the same TypeScript code run by the Worker.
const source = readFileSync(new URL('../src/aai-context.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const { resolveAAiFamilyVoice } = await import(
  'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
);

test('AAi recognizes Guh as Teguh Putra speaking directly', () => {
  const voice = resolveAAiFamilyVoice('teguh', 'Teguh Putra', 'ayah');
  assert.equal(voice.address, 'Guh');
  assert.match(voice.instruction, /berbicara LANGSUNG dengan Teguh Putra/);
  assert.match(voice.instruction, /orang ketiga yang berbeda/);
  assert.match(voice.instruction, /kamu yang merancang aku/);
});

test('AAi addresses Rosalia naturally as Lia or Ya without family-role intros', () => {
  const voice = resolveAAiFamilyVoice('rosalia', 'Rosalia', 'ibu');
  assert.equal(voice.address, 'Lia');
  assert.match(voice.instruction, /kadang Ya/);
  assert.match(voice.instruction, /minim basa-basi/);
  assert.match(voice.instruction, /Jangan menjelaskan/);
});

test('family account mismatch is neutral and child accounts do not imply who types', () => {
  assert.equal(resolveAAiFamilyVoice('teguh', 'Rosalia', 'ibu').address, 'Rosalia');
  assert.match(resolveAAiFamilyVoice('teguh', 'Rosalia', 'ibu').instruction, /jangan menebak/i);
  assert.match(resolveAAiFamilyVoice('ayaka', 'Putri Ayaka Azzahra', 'anak').instruction, /orang tua mungkin/);
  assert.match(resolveAAiFamilyVoice('ayato', 'Putra Ayato Zahran', 'anak').instruction, /orang tua mungkin/);
});
