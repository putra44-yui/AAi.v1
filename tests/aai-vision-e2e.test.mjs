import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../src/chat.ts';

const UUID_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const UUID_S = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const UUID_U = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const UUID_R = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const screenshot = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+lXr0AAAAASUVORK5CYII=';

test('vision HTTP chat really streams a multimodal provider payload without persisting the image', async () => {
  const original = globalThis.fetch;
  const requests = [];
  const providerPayloads = [];
  const stored = [];
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(typeof input === 'string' ? input : input.url);
      const method = (init.method || 'GET').toUpperCase();
      requests.push({ path: url.pathname, method });
      if (url.host === 'openrouter.ai') {
        const payload = JSON.parse(String(init.body || '{}'));
        providerPayloads.push(payload);
        if (payload.stream === false) {
          return Response.json({ choices: [{ message: { content: 'Membaca Gambar' } }] });
        }
        const stream = 'data: ' + JSON.stringify({
          model: payload.model,
          choices: [{ delta: { content:'Teks dalam screenshot adalah ABC-123.' } }],
        }) + '\n\ndata: [DONE]\n\n';
        return new Response(stream, { headers: { 'content-type':'text/event-stream' } });
      }
      if (url.pathname === '/rest/v1/sessions') {
        if (method === 'POST') return Response.json({ id:UUID_S });
        if (method === 'PATCH') return Response.json([]);
      }
      if (url.pathname === '/rest/v1/messages') {
        if (method === 'GET') return Response.json([]);
        if (method === 'POST') {
          const row = JSON.parse(String(init.body || '{}'));
          stored.push(row);
          return Response.json({ id:row.role === 'user' ? UUID_U : UUID_R });
        }
      }
      if (url.pathname === '/rest/v1/users') {
        return Response.json({ id:UUID_A, username:'fixture', person_id:null });
      }
      if (url.pathname === '/rest/v1/persons') return Response.json([]);
      throw new Error('Unhandled mock request: ' + method + ' ' + url.pathname);
    };

    const response = await POST(new Request('https://aai.example/api/chat', {
      method:'POST', headers:{'content-type':'application/json'},
      body:JSON.stringify({
        user_id:UUID_A,
        message:'Apa isi screenshot ini?',
        model_preference:'free-auto',
        web_permission:'allow',
        files:[{name:'test.png',type:'image/png',base64:screenshot}],
      }),
    }), {
      SUPABASE_URL:'https://fixture.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY:'fixture-secret',
      OPENROUTER_API_KEY:'fixture-api-key',
      OPENROUTER_MAIN_MODEL:'fixture/text-only',
      TAVILY_API_KEY:'fixture-search-key',
    });
    assert.equal(response.status, 200, await response.text());
    const sse = await response.text();
    assert.match(sse, /Teks dalam screenshot adalah ABC-123/);
    assert.match(sse, /"done":true/);

    const streamedPayload = providerPayloads.find(item => item.stream === true);
    assert.ok(streamedPayload);
    assert.equal(streamedPayload.model, 'deepseek/deepseek-v4.1-flash-1017');
    assert.equal(streamedPayload.tools, undefined, 'vision must not expose web tools');
    const user = streamedPayload.messages.findLast(item => item.role === 'user');
    assert.equal(user.content[0].text, 'Apa isi screenshot ini?');
    assert.equal(user.content[1].image_url.url, screenshot);
    assert.ok(stored.some(row => row.role === 'user' && row.content.includes('[📷 Lampiran gambar: 1')));
    assert.ok(stored.some(row => row.role === 'assistant'));
    assert.ok(stored.every(row => !JSON.stringify(row).includes('iVBORw0KGgoA')), 'base64 must never appear in DB writes');
    assert.equal(requests.filter(req => req.path.includes('search')).length, 0);
  } finally {
    globalThis.fetch = original;
  }
});
