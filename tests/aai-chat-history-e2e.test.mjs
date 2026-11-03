import test from 'node:test';
import assert from 'node:assert/strict';
import { POST } from '../src/chat.ts';

const OWNER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CURRENT = '33333333-3333-4333-8333-333333333333';
const PREVIOUS = '44444444-4444-4444-8444-444444444444';
const OTHER_SESSION = '55555555-5555-4555-8555-555555555555';
const UMSG = '66666666-6666-4666-8666-666666666666';
const AMSG = '77777777-7777-4777-8777-777777777777';

test('verified history tool pass uses real model function call and returns only owner excerpts', async () => {
  const oldFetch = globalThis.fetch;
  const providerPayloads = [];
  const dbRequests = [];
  try {
    globalThis.fetch = async (input, init={}) => {
      const url = new URL(String(input));
      const path = url.pathname;
      const method = (init.method || 'GET').toUpperCase();
      if (path === '/auth/v1/user') {
        return Response.json({
          id:'88888888-8888-4888-8888-888888888888',aud:'authenticated',
          created_at:'2026-11-03T00:00:00Z',
          app_metadata:{aai_user_id:OWNER},user_metadata:{aai_user_id:OTHER},
        });
      }
      if (url.hostname === 'openrouter.ai') {
        const payload=JSON.parse(init.body);
        providerPayloads.push(payload);
        if (payload.stream === false) {
          return Response.json({choices:[{message:{content:'Mengingat Ronaldo'}}]});
        }
        if (payload.tools) {
          const response = { choices: [{ delta: { tool_calls: [{
            index:0,id:'history-call-1',type:'function',
            function:{name:'search_chat_history',arguments:'{"query":"Ronaldo Messi PSG"}'},
          }] } }] };
          return new Response('data: '+JSON.stringify(response)+'\n\ndata: [DONE]\n\n',
            {headers:{'content-type':'text/event-stream'}});
        }
        return new Response('data: {"choices":[{"delta":{"content":"Aku menemukan obrolan Ronaldo dan Messi di sesi lain."}}]}\n\ndata: [DONE]\n\n',
          {headers:{'content-type':'text/event-stream'}});
      }
      dbRequests.push({path,method,search:url.searchParams});
      if (path==='/rest/v1/users') return Response.json({id:OWNER,username:'fixture',person_id:null});
      if (path==='/rest/v1/persons') return Response.json([]);
      if (path==='/rest/v1/sessions') {
        if (method==='POST') return Response.json({id:CURRENT});
        if (method==='PATCH') return Response.json([]);
        assert.equal(url.searchParams.get('user_id'),'eq.'+OWNER,'only verified user sessions may be searched');
        return Response.json([{id:PREVIOUS,title:'Ronaldo Messi',updated_at:'2026-11-02T00:00:00Z'}]);
      }
      if (path==='/rest/v1/messages') {
        if (method==='POST') {
          const body=JSON.parse(init.body);
          return Response.json({id:body.role==='user'?UMSG:AMSG});
        }
        if (url.searchParams.get('select')==='id,role,content,parent_id') return Response.json([]);
        const inFilter=url.searchParams.get('session_id') || '';
        assert.match(inFilter,new RegExp(PREVIOUS));
        assert.doesNotMatch(inFilter,new RegExp(OTHER_SESSION));
        return Response.json([
          {session_id:PREVIOUS,role:'user',
           content:'Ronaldo gacor lintas liga dan Messi ke PSG.',
           created_at:'2026-11-02T00:00:00Z'},
        ]);
      }
      throw new Error('Unexpected '+method+' '+url);
    };
    const request = new Request('https://aai.test/api/chat',{
      method:'POST',
      headers:{origin:'https://aai.test',cookie:'__Host-aai_access=fixture-jwt',
        'content-type':'application/json'},
      body:JSON.stringify({user_id:OWNER,message:'Kita habis bicara tentang Ronaldo, coba ingat lagi',
        web_permission:'allow'}),
    });
    const result=await POST(request,{
      SUPABASE_URL:'https://fixture.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY:'service-fixture',
      OPENROUTER_API_KEY:'openrouter-fixture',
      TAVILY_API_KEY:'web-fixture',
      AAI_AUTH_REQUIRED:'true',
      AAI_CROSS_SESSION_RECALL_ENABLED:'true',
    });
    assert.equal(result.status,200);
    const sse=await result.text();
    assert.match(sse,/Aku menemukan obrolan Ronaldo dan Messi/);
    assert.match(sse,/"step":"history"/);
    assert.match(sse,/"step":"history_found"/);
    assert.match(sse,/"done":true/);
    const toolPass=providerPayloads.find(x=>x.tools);
    assert.ok(toolPass);
    assert.deepEqual(toolPass.tools.map(x=>x.function.name),['search_chat_history']);
    const final=providerPayloads.find(x=>x.stream===true&&!x.tools);
    assert.ok(final);
    const toolResult=final.messages.find(x=>x.role==='tool');
    assert.ok(toolResult);
    assert.match(toolResult.content,/Ronaldo gacor lintas liga/);
    assert.doesNotMatch(toolResult.content,/rahasia orang lain/);
    assert.equal(dbRequests.filter(x=>x.path==='/rest/v1/sessions'&&x.method==='GET').length,1);
    assert.equal(dbRequests.filter(x=>x.path==='/rest/v1/messages'&&x.method==='GET').length,2);
  } finally { globalThis.fetch=oldFetch; }
});

test('no Auth session never offers history tool even with flags enabled', async () => {
  const oldFetch=globalThis.fetch;
  let historyToolUsed=false;
  try {
    globalThis.fetch=async (input,init={})=>{
      const url=new URL(String(input));
      const method=(init.method || 'GET').toUpperCase();
      if(url.hostname==='openrouter.ai'){
        const payload=JSON.parse(init.body);
        if(payload.tools?.some(x=>x.function.name==='search_chat_history')) historyToolUsed=true;
        return new Response('data: {"choices":[{"delta":{"content":"Belum bisa melihat sesi lain sebelum login terverifikasi."}}]}\n\ndata: [DONE]\n\n',
          {headers:{'content-type':'text/event-stream'}});
      }
      if(url.pathname==='/rest/v1/users')return Response.json({id:OWNER,username:'fixture',person_id:null});
      if(url.pathname==='/rest/v1/persons')return Response.json([]);
      if(url.pathname==='/rest/v1/sessions'&&method==='POST')return Response.json({id:CURRENT});
      if(url.pathname==='/rest/v1/sessions'&&method==='PATCH')return Response.json([]);
      if(url.pathname==='/rest/v1/messages'&&method==='GET')return Response.json([]);
      if(url.pathname==='/rest/v1/messages'&&method==='POST')return Response.json({id:UMSG});
      throw new Error('Unexpected '+method+' '+url);
    };
    const r=await POST(new Request('https://aai.test/api/chat',{
      method:'POST',headers:{origin:'https://aai.test','content-type':'application/json'},
      body:JSON.stringify({user_id:OWNER,message:'Ingat obrolan Ronaldo di sesi lain'}),
    }),{
      SUPABASE_URL:'https://fixture.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY:'service-fixture',
      OPENROUTER_API_KEY:'openrouter-fixture',
      AAI_AUTH_REQUIRED:'true',AAI_CROSS_SESSION_RECALL_ENABLED:'true',
    });
    assert.equal(r.status,200);
    await r.text();
    assert.equal(historyToolUsed,false);
  }finally{globalThis.fetch=oldFetch;}
});
