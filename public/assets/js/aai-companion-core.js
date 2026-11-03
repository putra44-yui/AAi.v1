/* AAi Companion pure helpers: shared between browser preview and tests. */
(function (scope, create) {
  const api = create();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (scope) scope.AAiCompanionCore = api;
}(typeof window !== 'undefined' ? window : null, function () {
  'use strict';
  const STOP_CHARS = 168;
  const NO_CHAT_MARKUP = /\x60{3}[\s\S]*?\x60{3}|!\[[^\]]*\]\([^)]*\)|<[^>]+>/g;
  function speechPlainText(text) {
    return String(text || '')
      .replace(NO_CHAT_MARKUP, ' [Konten lengkap tersedia di mode Chatbot.] ')
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
      .replace(/(?:^|\n)\s{0,3}#{1,6}\s+/g, '\n')
      .replace(/(?:^|\n)\s*(?:[-*]|\d+[.)])\s+/g, '\n')
      .replace(/\*\*|__|~~|\x60/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n').trim();
  }
  function graphemes(s) {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter('id', { granularity: 'grapheme' }).segment(s), x => x.segment);
    }
    return Array.from(s);
  }
  function count(s) { return graphemes(s).length; }
  function splitLong(sentence, cap) {
    const words = sentence.trim().split(/\s+/).filter(Boolean);
    const pieces = [];
    let part = '';
    for (const word of words) {
      if (count(word) > cap) {
        if (part) { pieces.push(part); part = ''; }
        const chars = graphemes(word);
        for (let at = 0; at < chars.length; at += cap) pieces.push(chars.slice(at, at + cap).join(''));
        continue;
      }
      const combined = part ? part + ' ' + word : word;
      if (count(combined) <= cap) part = combined;
      else { if (part) pieces.push(part); part = word; }
    }
    if (part) pieces.push(part);
    return pieces;
  }
  function paginateSpeech(text, maxChars = STOP_CHARS) {
    const cap = Math.max(50, Math.min(350, Math.floor(Number(maxChars) || STOP_CHARS)));
    const normalized = speechPlainText(text);
    if (!normalized) return [];
    const sentences = normalized.split(/(?<=[.!?。！？])\s+|\n+/u).map(s => s.trim()).filter(Boolean);
    const result = [];
    let page = '';
    const push = () => { if (page) result.push(page); page = ''; };
    for (const sentence of sentences) {
      const segments = count(sentence) > cap ? splitLong(sentence, cap) : [sentence];
      for (const segment of segments) {
        const candidate = page ? page + ' ' + segment : segment;
        if (count(candidate) > cap) push();
        page = page ? page + ' ' + segment : segment;
      }
    }
    push();
    return result;
  }
  function clampPosition(x, y, maxX, maxY) {
    return {
      x: Math.min(Math.max(0, Number(x) || 0), Math.max(0, Number(maxX) || 0)),
      y: Math.min(Math.max(0, Number(y) || 0), Math.max(0, Number(maxY) || 0)),
    };
  }
  const REACTIONS = Object.freeze({
    normal: [
      'Hmm? Ada yang mau diceritakan?', 'Heii, kaget aku. 😄',
      'Iya, aku di sini.', 'Hah? Kamu manggil aku?',
      'Pelan-pelan, aku dengar kok.', 'Hmm, ada apa nih?',
      'Eh, halo! Mau ngobrol?', 'Aku lagi merhatiin kamu, lho.',
      'Ih, tiba-tiba banget.', 'Mau tanya apa? Aku siap.',
    ],
    head: [
      'Duh… kepalaku, jangan dipegang sembarangan.', 'Ih, rambutku jadi berantakan.',
      'Hei, jangan asal elus… malu, tau.', 'Aduh, kaget aku!',
      'Pelan dong… aku bisa rapikan sendiri.', 'Ehh, malu aku.',
      'Kepalaku bukan tombol bel, ya. 😳', 'Ssst… tangannya dijaga, ya.',
    ],
    protect: [
      'Duh… jangan dipegang, malu.', 'Ih, jangan begitu dong.',
      'Heii, jaga tangan… malu aku.', 'Eh, nggak boleh sembarangan begitu.',
      'Ih… aku mundur dulu, ya.', 'Jangan usil di situ, dong.',
      'Bukan mahram, lho… jaga jarak, ya.', 'Aduh, bikin kaget saja.',
    ],
    repeat: [
      'Dari tadi usil terus, ya?', 'Heii… cukup dulu, ya.',
      'Aku lihat, kamu lagi iseng banget.', 'Ehem… jaga tangan.',
      'Jangan diulang-ulang, malu aku.', 'Ih, sengaja banget ya?',
    ],
  });
  function reactionFor(zone, recent = [], randomValue = Math.random()) {
    const choices = REACTIONS[zone] || REACTIONS.normal;
    const last = new Set(recent.slice(-4));
    const eligible = choices.filter(line => !last.has(line));
    const pool = eligible.length ? eligible : choices;
    const random = Number.isFinite(randomValue) ? Math.max(0, Math.min(.999999, randomValue)) : 0;
    return pool[Math.floor(random * pool.length)];
  }
  function classifyGesture(start, end, durationMs, dragThreshold = 9, longPressMs = 580) {
    const dx = Number(end.x) - Number(start.x);
    const dy = Number(end.y) - Number(start.y);
    if (Math.hypot(dx, dy) >= dragThreshold) return 'drag';
    if (durationMs >= longPressMs) return 'long-press';
    return 'tap';
  }
  return { paginateSpeech, speechPlainText, reactionFor, classifyGesture, clampPosition };
}));
