import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  resolveAAiPersona, selectRelevantAAiMemories, extractAAiMemoryTags, createAAiMemoryStreamFilter, readableAAiMemoryValue,
  isAAiRecallQuestion, searchAAiRecallMemories,
} from '../src/aai-context.ts';

test('legacy persona choices always resolve to one adaptive AAi voice', () => {
  assert.equal(resolveAAiPersona('Kritikus Brutal', 'Bantu bug JavaScript', 'Teguh Putra'), 'Auto');
  assert.equal(resolveAAiPersona('Rosalia', 'Halo, sayang', 'Rosalia'), 'Auto');
  assert.equal(resolveAAiPersona('Auto', 'Tolong kritik gagasanku', 'Teguh Putra'), 'Auto');
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

test('legacy JSON memories expose the factual value, not metadata', () => {
  const raw = JSON.stringify({ subject:'Teguh', relation:'diri', value:'Suka menguji argumen sampai tuntas' });
  assert.equal(readableAAiMemoryValue(raw), 'Suka menguji argumen sampai tuntas');
  const selected = selectRelevantAAiMemories([{id:'a',key:'gaya_berdebat',value:raw,priority_score:0.1}], 'Suka menguji argumen?', 3);
  assert.equal(selected.length, 1);
});

test('AAi governance preserves old evidence semantics and blocks unconfirmed conflicts', () => {
  const fs = requireSource('src/aai-memory-governance.ts');
  assert.match(fs, /person_memory_evidence/);
  assert.match(fs, /legacy_audit_log/);
  assert.match(fs, /unique_context_hash/);
  assert.match(fs, /memory_conflict/);
  assert.match(fs, /explicit_user_request/);
  assert.match(fs, /saveMemoryWithLockGuard/);
  assert.match(fs, /status: 'dropped'/);
  assert.doesNotMatch(fs, /process\.env/);
});

function requireSource(path) {
  return readFileSync(new URL('../' + path, import.meta.url), 'utf8');
}

test('self-assessment requests retrieve work patterns without unrelated family stories', () => {
  const rows = [
    {id:'work',key:'ritme_eksekusi',value:'Sering memikirkan arsitektur dan eksekusi',priority_score:.12},
    {id:'private',key:'beban_rumah_tangga',value:'Masalah dalam rumah',priority_score:.9},
  ];
  const result = selectRelevantAAiMemories(rows, 'Apa kelemahanku sebagai pembuat aplikasi?', 10);
  assert.deepEqual(result.map(row => row.key), ['ritme_eksekusi']);
});

test('historical recall is explicit and does not confuse requests to remember new facts', () => {
  assert.equal(isAAiRecallQuestion('Kita kan pernah berjanji, masih ingat?'), true);
  assert.equal(isAAiRecallQuestion('Kamu masih inget waktu kita bahas Benih AAi?'), true);
  assert.equal(isAAiRecallQuestion('Dulu kita pernah bahas notula, kan?'), true);
  assert.equal(isAAiRecallQuestion('Ingatkan aku besok jam delapan'), false);
  assert.equal(isAAiRecallQuestion('Ingat, aku suka bahasa santai. Simpan ya.'), false);
  assert.equal(isAAiRecallQuestion('Apa kabar hari ini?'), false);
});

test('deeper recall stays in the authenticated person, excludes existing and secret rows, and caps eight', async () => {
  const calls = [];
  const rows = [
    { id: 'already-present', key: 'benih_aai_target', value: 'Target Benih AAi 30M', priority_score: 0.9 },
    { id: 'sensitive', key: 'benih_aai_api_token', value: 'Token API untuk Benih AAi', priority_score: 1 },
    { id: 'other', key: 'favorit_makanan', value: 'Nasi goreng', priority_score: 1 },
    ...Array.from({ length: 13 }, (_, i) => ({
      id: `item-${i}`, key: `benih_aai_keputusan_${i}`, value: `Keputusan Benih AAi tahap ${i}`,
      priority_score: 0.8 - i / 100,
    })),
  ];
  const query = {
    select(fields) { calls.push(['select', fields]); return this; },
    eq(field, value) { calls.push(['eq', field, value]); return this; },
    order(field, direction) { calls.push(['order', field, direction]); return this; },
    async limit(n) { calls.push(['limit', n]); return { data: rows, error: null }; },
  };
  const supabase = {
    from(table) { calls.push(['from', table]); return query; },
  };
  const result = await searchAAiRecallMemories(
    supabase, 'owner-verified-by-auth', 'Kamu ingat Benih AAi yang pernah kita bahas?', ['already-present'],
  );
  assert.deepEqual(calls.find(item => item[0] === 'eq' && item[1] === 'person_id'),
    ['eq', 'person_id', 'owner-verified-by-auth']);
  assert.deepEqual(calls.find(item => item[0] === 'eq' && item[1] === 'status'),
    ['eq', 'status', 'active']);
  assert.equal(calls.find(item => item[0] === 'limit')[1], 420);
  assert.equal(result.matchCount, 8);
  assert.match(result.contextMessage.content, /Benih AAi/);
  assert.doesNotMatch(result.contextMessage.content, /Token API/);
  assert.doesNotMatch(result.contextMessage.content, /favorit makanan/);
  assert.doesNotMatch(result.contextMessage.content, /target \(fakta\)/);
});

test('deeper recall with no lexical match sends no additional private context', async () => {
  const query = {
    select() { return this; }, eq() { return this; }, order() { return this; },
    async limit() { return { data: [{ id:'unrelated', key:'warna_rumah', value:'Warna biru' }], error:null }; },
  };
  const result = await searchAAiRecallMemories(
    { from: () => query }, 'same-owner', 'Kamu ingat janji kita tentang notula?', [],
  );
  assert.equal(result.matchCount, 0);
  assert.equal(result.contextMessage, null);
});
