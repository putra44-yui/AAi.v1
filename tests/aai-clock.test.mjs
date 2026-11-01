import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAAiClockContext, normalizeAAiTimeZone } from '../src/aai-clock.ts';

const instant = new Date('2026-11-01T16:30:00.000Z');

test('WIB late evening is visible to AAi at first greeting', () => {
  const context = buildAAiClockContext('Asia/Pontianak', true, instant);
  assert.match(context, /23[.:]30/);
  assert.match(context, /WIB/);
  assert.match(context, /larut malam/);
  assert.match(context, /awal percakapan/);
  assert.match(context, /celetukan ringan/);
  assert.match(context, /dahulukan jawabannya/);
});

test('local clock follows device zone and ongoing chats do not repeat greetings', () => {
  const context = buildAAiClockContext('Asia/Makassar', false, instant);
  assert.match(context, /00[.:]30/);
  assert.match(context, /dini hari/);
  assert.match(context, /WITA/);
  assert.doesNotMatch(context, /Ini awal percakapan/);
  assert.match(context, /jangan mengulang salam/);
});

test('invalid device timezone uses an explicitly labelled WIB fallback', () => {
  assert.equal(normalizeAAiTimeZone('bad/timezone'), null);
  assert.equal(normalizeAAiTimeZone('Asia/Pontianak ' + 'invalid'), null);
  assert.equal(normalizeAAiTimeZone('Asia/Jakarta'), 'Asia/Jakarta');
  assert.match(buildAAiClockContext(null, true, instant), /default WIB/);
  assert.match(buildAAiClockContext(null, true, instant), /bukan lokasi yang terverifikasi/);
});
