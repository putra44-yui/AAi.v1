import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSessionRecallRequest, traceActiveBranch, findEarlierSessionRecall, sessionRecallGuidance,
} from '../src/aai-session-recall.ts';
import { readFileSync } from 'node:fs';

function fixture() {
  const rows = [];
  let parent = null;
  for (let n = 0; n < 26; n++) {
    const id = 'msg-' + n;
    const role = n % 2 === 0 ? 'user' : 'assistant';
    const content = n === 1
      ? 'Tadi kita membahas Ronaldo dan penghargaan BOAT. BOAT itu Best of All Time.'
      : 'Pesan pembahasan lain nomor ' + n + ' tentang teknologi dan kabar harian.';
    rows.push({ id, role, content, parent_id:parent });
    parent = id;
  }
  return {rows, parent};
}

test('Ronaldo recall finds an earlier turn outside the 16-message model window', () => {
  const {rows, parent} = fixture();
  const selected = findEarlierSessionRecall(rows, parent, 'Kita habis bicara tentang Ronaldo, coba ingat ingat lagi');
  assert.ok(selected);
  assert.equal(selected.subject, 'ronaldo');
  assert.equal(selected.checked, 26);
  assert.equal(selected.excerpts.length, 1);
  assert.match(selected.excerpts[0].text, /Ronaldo dan penghargaan BOAT/);
  const guidance = sessionRecallGuidance(selected);
  assert.match(guidance, /Ronaldo/);
  assert.match(guidance, /bukan seluruh sesi, database keluarga/);
  assert.doesNotMatch(guidance, /memori sudah kosong semua/i);
});

test('branch isolation: ignores a sibling message even if it mentions Ronaldo', () => {
  const {rows,parent} = fixture();
  rows[1].content = 'Kami membahas teknologi jaringan tanpa olahraga.';
  rows.push({id:'sibling',role:'assistant',content:'Ronaldo pernah juara BOAT.',parent_id:'msg-0'});
  const found = findEarlierSessionRecall(rows, parent, 'Ingat lagi tentang Ronaldo');
  assert.ok(found);
  assert.equal(found.excerpts.length, 0);
  assert.equal(traceActiveBranch(rows,parent).some(x=>x.id==='sibling'), false);
});

test('no evidence gives bounded language and never a claim of globally empty memory', () => {
  const {rows,parent} = fixture();
  const result = findEarlierSessionRecall(rows,parent,'Kita pernah bicara tentang Maradona, coba ingat');
  assert.equal(result.excerpts.length,0);
  const text = sessionRecallGuidance(result);
  assert.match(text, /belum menemukan di bagian obrolan yang bisa kubaca/);
  assert.doesNotMatch(text, /seluruh database.*kosong/i);
});

test('does not turn ordinary discussions and save-memory commands into recall', () => {
  const {rows,parent} = fixture();
  for (const message of ['Halo AAi', 'Apa itu statistik sepak bola?', 'Buat cerita tentang Ronaldo', 'Ingat ini: saya suka bola', 'Tolong catat rencana baru']) {
    assert.equal(isSessionRecallRequest(message), false,message);
    assert.equal(findEarlierSessionRecall(rows,parent,message),null,message);
  }
});

test('never leak an uploaded image marker into a recalled excerpt', () => {
  const {rows,parent} = fixture();
  rows[1].content += ' [📷 Lampiran gambar: 1 (gambar tidak disimpan di riwayat, kirim ulang)]';
  const result = findEarlierSessionRecall(rows,parent,'Ingat tentang Ronaldo');
  assert.match(result.excerpts[0].text,/lampiran tidak tersedia/);
  assert.doesNotMatch(result.excerpts[0].text,/gambar tidak disimpan di riwayat/);
});

test('server and UI wire the verified in-session evidence, not global memory search', () => {
  const server = readFileSync(new URL('../src/chat.ts',import.meta.url),'utf8');
  const client = readFileSync(new URL('../public/assets/js/app.js',import.meta.url),'utf8');
  assert.match(server,/findEarlierSessionRecall\(recent \?\? \[\], contextParentId, message\)/);
  assert.match(server,/content: sessionRecallGuidance\(sessionRecall\)/);
  assert.match(server,/phase: 'progress', step: 'recall'/);
  assert.match(client,/if \(step === 'recall'\)/);
});
