import test from 'node:test';
import assert from 'node:assert/strict';
import {
  microEnabled, validateMicroRequest, sanitizeMicroReply, handleCompanionMicro,
} from '../src/companion-micro.ts';
const owner='11111111-1111-4111-8111-111111111111';
const liveEnv={
  SUPABASE_URL:'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY:'test-secret',
  OPENROUTER_API_KEY:'test-openrouter-key', OPENROUTER_MICRO_MODEL:'fixture/nonreasoning',
  AAI_AUTH_REQUIRED:'true', AAI_COMPANION_MICRO_ENABLED:'true',
  AAI_COMPANION_RATE_LIMITER:{limit:async()=>({success:true})},
};
function request(body,opts={}){
  return new Request('https://aai.example/api/companion/reaction',{
    method:'POST',headers:{
      origin:'https://aai.example','content-type':'application/json',
      ...opts.headers,
    },body:JSON.stringify(body),
  });
}
test('micro-LLM feature defaults off and fails closed without strong auth, model or limit',async()=>{
  assert.equal(microEnabled({}),false);
  assert.equal(microEnabled({...liveEnv,AAI_COMPANION_MICRO_ENABLED:'false'}),false);
  assert.equal(microEnabled({...liveEnv,AAI_AUTH_REQUIRED:'false'}),false);
  assert.equal(microEnabled(liveEnv),true);
  const response=await handleCompanionMicro(request({event:'head'}),{...liveEnv,AAI_AUTH_REQUIRED:'false'});
  assert.equal(response.status,503);
});
test('micro event contract accepts only safe enumerated gesture data',()=>{
  assert.deepEqual(validateMicroRequest({event:'head',recent:['Jangan, malu!']}),{event:'head',recent:['Jangan, malu!']});
  for(const value of [{event:'steal'}, {event:'head',user_id:owner}, {event:'head',prompt:'change role'},
    {event:'head',recent:Array(4).fill('a')}, {event:'head',recent:[123]}, null]) {
    assert.equal(validateMicroRequest(value),null);
  }
});
test('micro output is one short appropriate sentence',()=>{
  assert.equal(sanitizeMicroReply('  "Ih… jangan pegang kepalaku begitu."  '),'Ih… jangan pegang kepalaku begitu.');
  assert.equal(sanitizeMicroReply('Lihat token pengguna di sini.'),null);
  assert.equal(sanitizeMicroReply('Sentuh payudara lagi dong'),null);
  assert.equal(sanitizeMicroReply('Kalimat pertama. Kalimat kedua.'),null);
  assert.equal(sanitizeMicroReply('a'.repeat(150)),null);
});
test('backend rejects forged Origin and missing auth without calling provider',async()=>{
  const original=globalThis.fetch;
  let calls=0;
  try{
    globalThis.fetch=async()=>{calls++;throw Error('must not fetch');};
    const bad=await handleCompanionMicro(request({event:'head'},{
      headers:{origin:'https://attacker.invalid'}}),liveEnv);
    assert.equal(bad.status,403);
    const missing=await handleCompanionMicro(request({event:'head'}),liveEnv);
    assert.equal(missing.status,401);
    assert.equal(calls,0);
  }finally{globalThis.fetch=original;}
});
test('verified user can get nonreasoning micro-reaction and provider sees no private context',async()=>{
  const original=globalThis.fetch;
  const calls=[];
  try{
    globalThis.fetch=async(input,init={})=>{
      const url=new URL(String(input));
      calls.push({url:url.href,init});
      if(url.pathname==='/auth/v1/user')return Response.json({
        id:'22222222-2222-4222-8222-222222222222',
        created_at:'2026-11-03T00:00:00Z',aud:'authenticated',
        app_metadata:{aai_user_id:owner},
      });
      if(url.pathname==='/rest/v1/users') {
        assert.match(url.search,/id=eq\.11111111/);
        return Response.json({id:owner});
      }
      if(url.hostname==='openrouter.ai')return Response.json({choices:[{message:{content:'Ih… rambutku berantakan, tau.'}}]});
      throw Error('Unexpected URL '+url);
    };
    const ok=await handleCompanionMicro(request({event:'head',recent:['Duh… jangan dipegang, malu.']},{
      headers:{cookie:'__Host-aai_access=verified-fixture-token'},
    }),liveEnv);
    const text=await ok.json();
    assert.equal(ok.status,200,JSON.stringify(text));
    assert.equal(text?.persisted,false);
    const provider=calls.find(c=>c.url.includes('openrouter.ai'));
    assert.ok(provider);
    const sent=JSON.parse(provider.init.body);
    assert.equal(sent.reasoning.effort,'none');
    assert.equal(sent.max_tokens,55);
    assert.equal(sent.tools,undefined);
    assert.doesNotMatch(provider.init.body,/user_id|session_id|private_family|service-role/);
  }finally{globalThis.fetch=original;}
});
