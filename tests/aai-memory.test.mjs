import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveAAiPersona, selectRelevantAAiMemories, extractAAiMemoryTags, createAAiMemoryStreamFilter,
} from '../src/aai-context.ts';

test('Auto persona respects the person and coding intent', () => {
  assert.equal(resolveAAiPersona('Auto', 'Bantu bug JavaScript', 'Teguh Putra'), 'Coding');
  assert.equal(resolveAAiPersona('Auto', 'Halo', 'Rosalia'), 'Rosalia');
  assert.equal(resolveAAiPersona('Auto', 'Halo', 'Teguh Putra'), 'Santai');
});

test('memory relevance excludes unrelated private context', () => {
  const rows = [
    {id:'a',key:'gaya_debat',value:'Teguh suka menguji argumen',priority_score:0.2},
    {id:'b',key:'selera_makanan',value:'Suka makan bakso hangat',priority_score:0.9},
  ];
  const selected = selectRelevantAAiMemories(rows, 'Bagaimana gaya debat Teguh?', 10);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].key, 'gaya_debat');
});

test('structured memory tags are extracted and stripped', () => {
  const raw = 'Aku mengerti, Guh. \n[MEMORY:type=preferensi;category=komunikasi;key=gaya_bahasa;value=Lebih suka jawaban langsung]\n';
  const parsed = extractAAiMemoryTags(raw);
  assert.equal(parsed.cleanText, 'Aku mengerti, Guh.');
  assert.deepEqual(parsed.candidates, [{
    key:'gaya_bahasa',value:'Lebih suka jawaban langsung',memoryType:'preferensi',category:'komunikasi',
  }]);
});

test('stream never emits internal memory tags across split tokens', () => {
  const f = createAAiMemoryStreamFilter();
  const emitted = ['Jawabannya. [ME','MORY:type=fakta;key=abc;value=sesuatu]',' Selesai.']
    .map(piece => f.push(piece)).join('') + f.finish();
  assert.equal(emitted, 'Jawabannya.  Selesai.');
});
