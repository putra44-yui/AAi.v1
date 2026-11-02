import test from 'node:test';
import assert from 'node:assert/strict';
import { POST, buildSessionContext } from '../src/chat.ts';
import { handleSessionApi } from '../src/session-api.ts';

const userId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const userMessageId = '33333333-3333-4333-8333-333333333333';
const assistantMessageId = '44444444-4444-4444-8444-444444444444';
const env = {
  SUPABASE_URL: 'https://fixture.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'fixture-not-a-secret',
  OPENROUTER_API_KEY: 'fixture-not-a-secret',
};

test('session context follows the active parent chain, ignoring sibling replies', () => {
  const rows = [
    { id: 'u1', role: 'user', content: 'Halo', parent_id: null },
    { id: 'a1', role: 'assistant', content: 'Hai', parent_id: 'u1' },
    { id: 'u2', role: 'user', content: 'Lanjut', parent_id: 'a1' },
    { id: 'a2', role: 'assistant', content: 'Jawaban utama', parent_id: 'u2' },
    { id: 'a3', role: 'assistant', content: 'Jawaban versi lain', parent_id: 'u2' },
  ];
  assert.deepEqual(buildSessionContext(rows, 'a2'), [
    { role: 'user', content: 'Halo' },
    { role: 'assistant', content: 'Hai' },
    { role: 'user', content: 'Lanjut' },
    { role: 'assistant', content: 'Jawaban utama' },
  ]);
  assert.equal(buildSessionContext(rows, 'a3').at(-1).content, 'Jawaban versi lain');
  assert.deepEqual(buildSessionContext(rows, 'unknown'), []);
});

test('invalid session IDs are rejected without contacting Supabase', async () => {
  const response = await POST(new Request('https://aai.example/api/chat', {
    method: 'POST',
    body: JSON.stringify({ action: 'load_session', session_id: 'not-a-uuid', user_id: userId }),
  }), env);
  assert.equal(response.status, 400);
});

test('new chat is saved before stream reports completion, with real DB IDs', async () => {
  const oldFetch = globalThis.fetch;
  const dbCalls = [];
  const providerCalls = [];
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      const method = init.method || 'GET';
      if (url.includes('openrouter.ai')) {
        const payload = JSON.parse(init.body);
        providerCalls.push(payload);
        return new Response('data: {"choices":[{"delta":{"content":"Halo lagi!"}}]}\n\ndata: [DONE]\n\n', {
          status: 200, headers: { 'content-type': 'text/event-stream' },
        });
      }
      assert.match(url, /fixture\.supabase\.co\/rest\/v1\//);
      const resource = new URL(url).pathname.split('/').at(-1);
      const body = init.body ? JSON.parse(init.body) : null;
      dbCalls.push({ resource, method, body });
      if (resource === 'users' && method === 'GET') {
        return Response.json({ id: userId, username: 'teguh', person_id: null });
      }
      if (resource === 'persons' && method === 'GET') return Response.json([]);
      if (resource === 'ai_personas' && method === 'GET') return Response.json([]);
      if (resource === 'sessions' && method === 'POST') {
        return Response.json({ id: sessionId }, { status: 201 });
      }
      if (resource === 'sessions' && method === 'PATCH') {
        return new Response(null, { status: 204 });
      }
      if (resource === 'messages' && method === 'GET') {
        return Response.json([], { status: 200 });
      }
      if (resource === 'messages' && method === 'POST') {
        return Response.json({ id: body.role === 'user' ? userMessageId : assistantMessageId }, { status: 201 });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    };

    const response = await POST(new Request('https://aai.example/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: 'Halo AAi', user_id: userId }),
    }), env);
    assert.equal(response.status, 200);
    const stream = await response.text();
    assert.match(stream, new RegExp(sessionId));
    assert.match(stream, new RegExp(assistantMessageId));
    assert.match(stream, /"done":true/);
    const events = stream.split('\n\n').filter(line => line.startsWith('data: '))
      .map(line => JSON.parse(line.slice(6))).filter(event => typeof event === 'object');
    const progress = events.filter(event => event.phase === 'progress');
    assert.ok(progress.some(event => event.step === 'provider' && /menunggu kata pertama/i.test(event.message)));
    assert.ok(progress.every(event => Number.isFinite(event.at_ms)));
    const completed = events.find(event => event.done);
    assert.ok(Number.isFinite(completed?.timings?.duration_ms));
    assert.ok(Number.isFinite(completed?.timings?.first_token_ms));
    assert.equal(dbCalls.find(c => c.resource === 'sessions' && c.method === 'POST').body.user_id, userId);
    assert.deepEqual(dbCalls.filter(c => c.resource === 'messages' && c.method === 'POST')
      .map(c => c.body.role), ['user', 'assistant']);
    assert.equal(dbCalls.find(c => c.resource === 'messages' && c.body?.role === 'assistant').body.content, 'Halo lagi!');
    const trace = dbCalls.find(c => c.resource === 'messages' && c.body?.role === 'assistant').body.activity_trace;
    assert.ok(trace.steps.some(step => step.step === 'provider' && Number.isFinite(step.atMs)));
    assert.ok(Number.isFinite(trace.firstTokenMs));
    assert.equal(completed.timings.duration_ms, trace.durationMs,
      'Live JSON duration and persisted JSON duration must not change after reload');
    assert.equal(completed.timings.first_token_ms, trace.firstTokenMs);
    assert.doesNotMatch(JSON.stringify(trace), /fixture-not-a-secret/);
    assert.equal(providerCalls[0].model, 'qwen/qwen3.8-omni-flash');
    assert.match(providerCalls[0].messages[0].content, /AAi.*Teguh/);
    assert.deepEqual(providerCalls[0].messages.at(-1), { role: 'user', content: 'Halo AAi' });
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('session API requires a user ID for deleting a session', async () => {
  const response = await handleSessionApi(new Request(
    `https://aai.example/api/sessions/${sessionId}`, { method: 'DELETE' },
  ), env);
  assert.equal(response.status, 400);
});

test('unknown session owner cannot rename a chat', async () => {
  const oldFetch = globalThis.fetch;
  const methods = [];
  try {
    globalThis.fetch = async (_input, init = {}) => {
      methods.push(init.method || 'GET');
      return Response.json(null);
    };
    const response = await handleSessionApi(new Request(
      `https://aai.example/api/sessions/${sessionId}`, {
        method: 'PUT',
        body: JSON.stringify({ user_id: userId, title: 'Tidak boleh' }),
      },
    ), env);
    assert.equal(response.status, 404);
    assert.deepEqual(methods, ['GET']);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('previous chat context is sent to Omni Flash along the selected branch only', async () => {
  const oldFetch = globalThis.fetch;
  let sentMessages = null;
  const firstUserId = '55555555-5555-4555-8555-555555555555';
  const firstAssistantId = '66666666-6666-4666-8666-666666666666';
  const siblingId = '77777777-7777-4777-8777-777777777777';
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const method = init.method || 'GET';
      if (url.hostname === 'openrouter.ai') {
        sentMessages = JSON.parse(init.body).messages;
        return new Response('data: {"choices":[{"delta":{"content":"Baik!"}}]}\n\n', {
          headers: { 'content-type': 'text/event-stream' },
        });
      }
      const resource = url.pathname.split('/').at(-1);
      if (resource === 'users' && method === 'GET') return Response.json({ id: userId, username: 'teguh', person_id: null });
      if (resource === 'persons' && method === 'GET') return Response.json([]);
      if (resource === 'ai_personas' && method === 'GET') return Response.json([]);
      if (resource === 'sessions' && method === 'GET') return Response.json({ id: sessionId });
      if (resource === 'sessions' && method === 'PATCH') return new Response(null, { status: 204 });
      if (resource === 'messages' && method === 'GET' &&
          url.searchParams.get('select') === 'id') {
        return Response.json({ id: firstAssistantId });
      }
      if (resource === 'messages' && method === 'GET') {
        return Response.json([
          { id: siblingId, role: 'assistant', content: 'Jawaban alternatif', parent_id: firstUserId },
          { id: firstAssistantId, role: 'assistant', content: 'Jawaban utama', parent_id: firstUserId },
          { id: firstUserId, role: 'user', content: 'Pertanyaan pertama', parent_id: null },
        ]);
      }
      if (resource === 'messages' && method === 'POST') {
        return Response.json({ id: JSON.parse(init.body).role === 'user'
          ? userMessageId : assistantMessageId }, { status: 201 });
      }
      throw new Error(`Unexpected mock request: ${method} ${url}`);
    };
    const response = await POST(new Request('https://aai.example/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        user_id: userId,
        parent_id: firstAssistantId,
        message: 'Lanjutkan',
      }),
    }), env);
    assert.equal(response.status, 200);
    await response.text();
    assert.equal(sentMessages[0].role, 'system');
    assert.deepEqual(sentMessages.slice(-3), [
      { role: 'user', content: 'Pertanyaan pertama' },
      { role: 'assistant', content: 'Jawaban utama' },
      { role: 'user', content: 'Lanjutkan' },
    ]);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('editing the first user message creates a valid alternate root branch', async () => {
  const originalFetch = globalThis.fetch;
  const inserted = [];
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      const method = init.method || 'GET';
      if (url.hostname === 'openrouter.ai') {
        return new Response('data: {"choices":[{"delta":{"content":"Pertanyaan awal direvisi."}}]}\n\ndata: [DONE]\n\n', {
          status: 200, headers: { 'content-type': 'text/event-stream' },
        });
      }
      const resource = url.pathname.split('/').at(-1);
      if (resource === 'sessions' && method === 'GET') return Response.json({ id: sessionId });
      if (resource === 'sessions' && method === 'PATCH') return new Response(null, { status: 204 });
      if (resource === 'messages' && method === 'GET') {
        return Response.json([
          { id: assistantMessageId, role: 'assistant', content: 'Jawaban awal', parent_id: userMessageId },
          { id: userMessageId, role: 'user', content: 'Pertanyaan awal', parent_id: null },
        ]);
      }
      if (resource === 'messages' && method === 'POST') {
        const body = JSON.parse(init.body);
        inserted.push(body);
        return Response.json({ id: body.role === 'user'
          ? '55555555-5555-4555-8555-555555555555'
          : '66666666-6666-4666-8666-666666666666' }, { status: 201 });
      }
      if (resource === 'users' && method === 'GET') {
        return Response.json({ id: userId, username: 'teguh', person_id: null });
      }
      if (resource === 'persons' && method === 'GET') return Response.json([]);
      if (resource === 'ai_personas' && method === 'GET') return Response.json([]);
      throw new Error('Unexpected fixture: ' + method + ' ' + url);
    };
    const response = await POST(new Request('https://aai.example/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        user_id: userId, session_id: sessionId, message: 'Pertanyaan awal direvisi',
        parent_id: null, branch_root: true,
      }),
    }), env);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /"done":true/);
    assert.equal(inserted[0].role, 'user');
    assert.equal(inserted[0].parent_id, null);
    assert.equal(inserted[1].role, 'assistant');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

async function mockNewChatDatabase(input, init, inserted) {
  const url = new URL(String(input));
  const method = init.method || 'GET';
  assert.equal(url.hostname, 'fixture.supabase.co');
  const resource = url.pathname.split('/').at(-1);
  if (resource === 'users' && method === 'GET') return Response.json({ id: userId, username: 'teguh', person_id: null });
  if (resource === 'persons' && method === 'GET') return Response.json([]);
  if (resource === 'ai_personas' && method === 'GET') return Response.json([]);
  if (resource === 'sessions' && method === 'POST') return Response.json({ id: sessionId }, { status: 201 });
  if (resource === 'sessions' && method === 'PATCH') return new Response(null, { status: 204 });
  if (resource === 'messages' && method === 'GET') return Response.json([]);
  if (resource === 'messages' && method === 'POST') {
    const body = JSON.parse(init.body);
    inserted.push(body);
    return Response.json({ id: body.role === 'user' ? userMessageId : assistantMessageId }, { status: 201 });
  }
  throw new Error(`Unexpected mock DB request: ${method} ${url}`);
}

test('search-required model returning only a keyword never leaks or saves it as an answer', async () => {
  const previousFetch = globalThis.fetch;
  const inserted = [];
  const providerCalls = [];
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.hostname === 'openrouter.ai') {
        const payload = JSON.parse(init.body);
        providerCalls.push(payload);
        return new Response('data: {"choices":[{"delta":{"content":"berita Raffi Ahmad terbaru Juni 2026"}}]}\n\ndata: [DONE]\n\n', {
          status: 200, headers: { 'content-type': 'text/event-stream' },
        });
      }
      return mockNewChatDatabase(input, init, inserted);
    };
    const response = await POST(new Request('https://aai.example/api/chat', {
      method: 'POST', body: JSON.stringify({ message: 'Coba cari berita tentang Raffi Ahmad terbaru', user_id: userId, web_permission: 'allow' }),
    }), { ...env, TAVILY_API_KEY: 'fixture-only' });
    assert.equal(response.status, 200);
    const events = await response.text();
    assert.match(events, /"done":true/);
    assert.match(events, /belum berhasil menjalankan pencarian web/);
    assert.doesNotMatch(events, /berita Raffi Ahmad terbaru Juni 2026/);
    assert.equal(inserted.find(row => row.role === 'assistant').content.includes('belum berhasil menjalankan pencarian web'), true);
    assert.ok(inserted.find(row => row.role === 'assistant').activity_trace.steps.some(step => step.step === 'unavailable'));
    assert.equal(providerCalls[0].tool_choice, 'required');
    assert.equal(providerCalls.filter(call => call.tools).length, 1, 'Do not silently retry a required search without tools');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('a provider that rejects native tools cannot invent a search result in a fallback reply', async () => {
  const previousFetch = globalThis.fetch;
  const inserted = [];
  const providerCalls = [];
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.hostname === 'openrouter.ai') {
        providerCalls.push(JSON.parse(init.body));
        return Response.json({ error: 'Tool calling unsupported by selected model' }, { status: 400 });
      }
      return mockNewChatDatabase(input, init, inserted);
    };
    const response = await POST(new Request('https://aai.example/api/chat', {
      method: 'POST', body: JSON.stringify({ message: 'Coba cari berita terbaru tentang Raffi Ahmad', user_id: userId, web_permission: 'allow' }),
    }), { ...env, TAVILY_API_KEY: 'fixture-only' });
    assert.equal(response.status, 200);
    const events = await response.text();
    assert.match(events, /"done":true/);
    assert.match(events, /Belum ada pencarian web yang dijalankan/);
    assert.equal(inserted.find(row => row.role === 'assistant').content.includes('belum berhasil menjalankan pencarian web'), true);
    assert.equal(providerCalls.length, 1, 'No second, tool-less model request after failed explicit search');
    assert.equal(providerCalls[0].tool_choice, 'required');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('model cannot report empty search results before the real tool response', async () => {
  const previousFetch = globalThis.fetch;
  const inserted = [];
  const providerCalls = [];
  const toolRequest = 'data: {"choices":[{"delta":{"content":"Hasil pencariannya kosong, Bos. Nggak ada berita yang masuk."}}]}\n\n'
    + 'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_web","type":"function","function":{"name":"search_web","arguments":"{\\"query\\":\\"Raffi Ahmad berita terbaru\\"}"}}]}}]}\n\n'
    + 'data: [DONE]\n\n';
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.hostname === 'openrouter.ai') {
        const payload = JSON.parse(init.body);
        providerCalls.push(payload);
        const body = payload.tools && !payload.messages.some(item => item.role === 'tool')
          ? toolRequest
          : 'data: {"choices":[{"delta":{"content":"Aku menemukan satu sumber yang bisa dibaca."}}]}\n\ndata: [DONE]\n\n';
        return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
      }
      if (url.hostname === 'api.tavily.com') return Response.json({ results: [{
        url: 'https://berita.example/raffi', title: 'Berita Raffi Ahmad', content: 'Sumber uji.',
      }] });
      return mockNewChatDatabase(input, init, inserted);
    };
    const response = await POST(new Request('https://aai.example/api/chat', {
      method: 'POST', body: JSON.stringify({ message: 'Coba cari berita tentang Raffi Ahmad terbaru', user_id: userId, web_permission: 'allow' }),
    }), { ...env, TAVILY_API_KEY: 'fixture-only', AAI_WEB_SEARCH_LIMITER: { limit: async () => ({ success: true }) } });
    assert.equal(response.status, 200);
    const events = await response.text();
    assert.match(events, /"done":true/);
    assert.doesNotMatch(events, /Hasil pencariannya kosong/);
    assert.match(events, /https:\/\/berita\.example\/raffi/);
    assert.match(events, /Aku menemukan satu sumber/);
    assert.equal(inserted.find(row => row.role === 'assistant').content, 'Aku menemukan satu sumber yang bisa dibaca.');
    assert.ok(inserted.find(row => row.role === 'assistant').activity_trace.steps.some(step =>
      step.step === 'sources' && step.sources[0].url === 'https://berita.example/raffi'));
    assert.equal(providerCalls.filter(call => call.tools).length, 2);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('a previously saved process trail is included when the same session opens on another device', async () => {
  const previousFetch = globalThis.fetch;
  const storedTrace = { durationMs: 7400, steps: [{ step: 'assess', message: 'Menyiapkan jawaban...' }], preface: '' };
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      assert.equal(url.hostname, 'fixture.supabase.co');
      const resource = url.pathname.split('/').at(-1);
      if (resource === 'sessions') return Response.json({ id: sessionId });
      if (resource === 'messages') return Response.json([{
        id: assistantMessageId, role: 'assistant', content: 'Halo!', parent_id: userMessageId,
        created_at: '2026-11-01T02:00:00Z', activity_trace: storedTrace,
      }]);
      throw new Error('Unexpected request: ' + url);
    };
    const response = await POST(new Request('https://aai.example/api/chat', {
      method: 'POST', body: JSON.stringify({ action: 'load_session', session_id: sessionId, user_id: userId }),
    }), env);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body.messages[0].activity_trace, storedTrace);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
