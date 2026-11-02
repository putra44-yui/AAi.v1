import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.ts';
import { authRequired, sameOriginMutation, stripAndAuthorizeClientIdentity } from '../src/aai-auth.ts';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const authId = '33333333-3333-4333-8333-333333333333';
const origin = 'https://aai.example';
const env = {
  SUPABASE_URL: 'https://fixture.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'server-fixture-not-real',
  AAI_AUTH_REQUIRED: 'true',
  AAI_RECALL_SEARCH_ENABLED: 'true',
  ASSETS: { fetch: async () => new Response('assets') },
};

test('auth mode is explicit and fail-closed when enabled', () => {
  assert.equal(authRequired({}), false, 'Migration keeps existing installation running until account enrollment');
  assert.equal(authRequired({ AAI_AUTH_REQUIRED: 'true' }), true);
  assert.equal(sameOriginMutation(new Request(origin + '/api/chat', {
    method: 'POST', headers: { origin: 'https://attacker.invalid' },
  })), false);
  assert.equal(sameOriginMutation(new Request(origin + '/api/chat', {
    method: 'POST', headers: { origin },
  })), true);
});

test('unverified API requests cannot fetch family sessions or planning notes', async () => {
  for (const url of ['/api/sessions?user_id=' + owner, '/api/planning-memory?user_id=' + owner, '/api/file-jobs?job_id=' + other]) {
    const r = await worker.fetch(new Request(origin + url), env);
    assert.equal(r.status, 401, url);
    assert.equal((await r.json()).error, 'Sesi tidak valid. Silakan masuk kembali.');
  }
});

test('client-supplied IDs cannot override the verified account', async () => {
  await assert.rejects(stripAndAuthorizeClientIdentity(
    new Request(origin + '/api/sessions?user_id=' + other), owner),
  /IDOR/);
  await assert.rejects(stripAndAuthorizeClientIdentity(
    new Request(origin + '/api/chat', { method:'POST', headers: { 'content-type':'application/json' },
      body: JSON.stringify({ message:'Hallo', user_id:other }) }), owner,
  ), /IDOR/);
  const allowed = await stripAndAuthorizeClientIdentity(
    new Request(origin + '/api/chat', { method:'POST', headers: { 'content-type':'application/json' },
      body: JSON.stringify({ message:'Halo' }) }), owner,
  );
  assert.equal((await allowed.json()).user_id, owner);
});

test('verified auth token cannot be reused to impersonate another AAi username', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      calls.push(url.pathname);
      if (url.pathname === '/auth/v1/user') {
        return Response.json({
          id: authId, aud:'authenticated', app_metadata: { aai_user_id:owner },
          user_metadata: { aai_user_id:other }, email:'fixture@example.com',
          created_at:'2026-11-03T00:00:00.000Z',
        });
      }
      if (url.pathname === '/rest/v1/users') {
        return Response.json({ id:owner, username:'teguh', person_id:null });
      }
      throw new Error('Unexpected request: ' + url);
    };
    const request = new Request(origin + '/api/sessions?user_id=' + other, {
      headers: {cookie:'__Host-aai_access=valid-token-for-owner'},
    });
    const response = await worker.fetch(request, env);
    assert.equal(response.status, 403);
    assert.ok(calls.includes('/auth/v1/user'));
    assert.equal(calls.filter(path => path === '/rest/v1/sessions').length, 0);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('cross-site mutation is blocked before authenticating cookie credentials', async () => {
  const response = await worker.fetch(new Request(origin + '/api/chat', {
    method:'POST', headers: { 'content-type':'application/json',
      origin:'https://evil.example', cookie:'__Host-aai_access=potentially-valid' },
    body: JSON.stringify({ message:'read secrets', user_id:owner }),
  }), env);
  assert.equal(response.status, 403);
});

test('verified sign-in issues HttpOnly cookies and /api/me returns the linked legacy account', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.pathname === '/auth/v1/token') {
        return Response.json({
          access_token:'fixture-jwt', refresh_token:'fixture-refresh',
          token_type:'bearer', expires_in:3600, expires_at:1900000000,
          user: { id:authId, aud:'authenticated', email:'owner@example.com',
            app_metadata: { aai_user_id:owner }, created_at:'2026-11-03T00:00:00Z' },
        });
      }
      if (url.pathname === '/auth/v1/user') {
        return Response.json({ id:authId, email:'owner@example.com', aud:'authenticated',
          app_metadata:{ aai_user_id:owner }, created_at:'2026-11-03T00:00:00Z' });
      }
      if (url.pathname === '/rest/v1/users') {
        return Response.json({ id:owner, username:'teguh', person_id:null });
      }
      throw new Error('Unexpected fixture: ' + url);
    };
    const login = await worker.fetch(new Request(origin + '/api/login', {
      method:'POST', headers:{ origin, 'content-type':'application/json' },
      body: JSON.stringify({ email:'owner@example.com', password:'test-only-not-real' }),
    }), env);
    assert.equal(login.status, 200);
    assert.equal((await login.json()).user.id, owner);
    const cookies = login.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    assert.ok(cookies.every(x => x.includes('HttpOnly') && x.includes('Secure') && x.includes('SameSite=Strict')));
    assert.ok(cookies.some(x => x.includes('__Host-aai_access=')));
    const me = await worker.fetch(new Request(origin + '/api/me', {
      headers: { cookie:'__Host-aai_access=fixture-jwt' },
    }), env);
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.id, owner);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
