import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SEARCH_CHAT_HISTORY_TOOL, parseHistoryToolQuery,
  historyToolEnabled, verifiedHistoryOwner, isHistoryRecallIntent,
  searchChatHistory, HISTORY_MAX_SESSIONS, HISTORY_MAX_EXCERPTS,
} from '../src/aai-chat-history.ts';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const sid1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sid2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const sidOther = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const flagEnv = {
  SUPABASE_URL:'https://fixture.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY:'test-service-key',
  AAI_AUTH_REQUIRED:'true',
  AAI_CROSS_SESSION_RECALL_ENABLED:'true',
};

test('tool has strict schema: query only, never user_id, owner, scope or max_sessions', () => {
  assert.equal(SEARCH_CHAT_HISTORY_TOOL.function.name, 'search_chat_history');
  assert.deepEqual(Object.keys(SEARCH_CHAT_HISTORY_TOOL.function.parameters.properties), ['query']);
  assert.deepEqual(SEARCH_CHAT_HISTORY_TOOL.function.parameters.required, ['query']);
  const call = (args, name = 'search_chat_history') =>
    ({id:'tool-1',type:'function',function:{name,arguments:JSON.stringify(args)}});
  assert.equal(parseHistoryToolQuery(call({query:'Ronaldo Messi PSG'})), 'Ronaldo Messi PSG');
  assert.equal(parseHistoryToolQuery(call({query:'Ronaldo',user_id:other})), null);
  assert.equal(parseHistoryToolQuery(call({query:''})), null);
  assert.equal(parseHistoryToolQuery(call({query:'x'.repeat(161)})), null);
  assert.equal(parseHistoryToolQuery(call({query:'Ronaldo'},'search_web')), null);
});

test('recall intent is not generic web search or a save-memory command', () => {
  assert.equal(isHistoryRecallIntent('Kita habis bicara tentang Ronaldo, coba ingat lagi'), true);
  assert.equal(isHistoryRecallIntent('Cari di riwayat tentang Messi'), true);
  assert.equal(isHistoryRecallIntent('Cek chat sesi lain soal PPK'), true);
  assert.equal(isHistoryRecallIntent('Ingat ini: saya suka fotografi'), false);
  assert.equal(isHistoryRecallIntent('Coba cari di web statistik Ronaldo'), false);
  assert.equal(isHistoryRecallIntent('Halo, AAi'), false);
});

test('private search feature defaults OFF, requires verified auth and explicit flag', async () => {
  assert.equal(historyToolEnabled({}), false);
  assert.equal(historyToolEnabled({...flagEnv,AAI_AUTH_REQUIRED:'false'}), false);
  assert.equal(historyToolEnabled({...flagEnv,AAI_CROSS_SESSION_RECALL_ENABLED:'false'}), false);
  assert.equal(historyToolEnabled(flagEnv), true);
  const none = await verifiedHistoryOwner(new Request('https://aai.test/api/chat', {
    method:'POST',headers:{origin:'https://aai.test',cookie:'__Host-aai_access=fake'},
  }), {...flagEnv,AAI_AUTH_REQUIRED:'false'}, owner);
  assert.equal(none, null);
  assert.equal(await verifiedHistoryOwner(new Request('https://aai.test/api/chat'),flagEnv,owner),null);
});

test('server refuses forged browser ID and user_metadata even with a valid Auth token', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async input => {
      calls++;
      const url = new URL(String(input));
      assert.equal(url.pathname, '/auth/v1/user');
      return Response.json({
        id:'33333333-3333-4333-8333-333333333333',
        aud:'authenticated', created_at:'2026-11-03T00:00:00Z',
        app_metadata:{aai_user_id:owner},
        user_metadata:{aai_user_id:other},
      });
    };
    const build = userId => verifiedHistoryOwner(new Request('https://aai.test/api/chat', {
      method:'POST',
      headers:{origin:'https://aai.test',cookie:'__Host-aai_access=verified-fixture'},
    }),flagEnv,userId);
    assert.equal(await build(owner),owner);
    assert.equal(await build(other),null,'a browser-supplied ID must never override verified app_metadata');
    assert.ok(calls>=2);
    const crossOrigin = await verifiedHistoryOwner(new Request('https://aai.test/api/chat', {
      method:'POST',headers:{origin:'https://bad.invalid',cookie:'__Host-aai_access=verified-fixture'},
    }),flagEnv,owner);
    assert.equal(crossOrigin,null);
    assert.equal(calls,2,'no auth call should happen for cross-origin requests');
  } finally { globalThis.fetch=original; }
});

function fakeDb() {
  const visits = [];
  const sessions = [
    {id:sid1,user_id:owner,title:'Ronaldo GOAT',updated_at:'2026-11-03T01:00:00Z'},
    {id:sid2,user_id:owner,title:'Messi PSG',updated_at:'2026-11-02T01:00:00Z'},
    {id:sidOther,user_id:other,title:'Rahasia orang lain',updated_at:'2026-11-03T02:00:00Z'},
  ];
  const messages = [
    {session_id:sid1,role:'user',content:'Ronaldo gacor lintas liga, termasuk Juventus dan Manchester United',created_at:'2026-11-03T01:00:00Z'},
    {session_id:sid2,role:'assistant',content:'Messi bermain untuk PSG dan adaptasinya jadi bahan diskusi Ronaldo',created_at:'2026-11-02T02:00:00Z'},
    {session_id:sidOther,role:'user',content:'Ronaldo pribadi keluarga rahasia sekali',created_at:'2026-11-03T02:00:00Z'},
  ];
  const client = {
    from(table) {
      const query = {table, predicates:[],limitCount:100,orderBy:null};
      const chain = {
        select(){return this;},
        eq(field,value){query.predicates.push({op:'eq',field,value});return this;},
        neq(field,value){query.predicates.push({op:'neq',field,value});return this;},
        in(field,value){query.predicates.push({op:'in',field,value});return this;},
        order(field){query.orderBy=field;return this;},
        limit(n){query.limitCount=n;return this;},
        then(resolve,reject) {
          visits.push(query);
          const input = table==='sessions'?sessions:messages;
          const data = input.filter(row=>query.predicates.every(x=>{
            if(x.op==='eq')return row[x.field]===x.value;
            if(x.op==='neq')return row[x.field]!==x.value;
            if(x.op==='in')return x.value.includes(row[x.field]);
            return false;
          })).slice(0,query.limitCount);
          return Promise.resolve({data,error:null}).then(resolve,reject);
        },
      };
      return chain;
    },
  };
  return {client,visits};
}

test('search scopes sessions by verified owner then messages by owned session IDs', async () => {
  const {client,visits} = fakeDb();
  const result = await searchChatHistory(client,owner,'Ronaldo Messi',null);
  assert.equal(result.ok,true);
  assert.equal(result.searchedSessions,2);
  assert.equal(result.found,2);
  assert.ok(result.excerpts.some(row=>/Ronaldo gacor/.test(row.text)));
  assert.ok(result.excerpts.every(row=>!row.text.includes('rahasia')));
  assert.ok(visits[0].predicates.some(x=>x.op==='eq'&&x.field==='user_id'&&x.value===owner));
  const inFilter = visits[1].predicates.find(x=>x.op==='in'&&x.field==='session_id');
  assert.deepEqual(inFilter.value,[sid1,sid2]);
  assert.ok(visits[0].limitCount<=HISTORY_MAX_SESSIONS);
  assert.ok(visits[1].limitCount<=300);
  assert.ok(result.excerpts.length<=HISTORY_MAX_EXCERPTS);
});

test('excluding active session and vague queries never open unrelated data', async () => {
  const {client,visits} = fakeDb();
  const result = await searchChatHistory(client,owner,'Ronaldo',sid1);
  assert.equal(result.found,1);
  assert.equal(visits[0].predicates.some(x=>x.op==='neq'&&x.field==='id'&&x.value===sid1),true);
  assert.ok(result.excerpts.every(x=>!x.text.startsWith('Ronaldo gacor')));
  const before = visits.length;
  const vague = await searchChatHistory(client,owner,'kita tadi ingat lagi',sid1);
  assert.equal(vague.found,0);
  assert.equal(visits.length,before,'do not dump unrelated data for a vague prompt');
});

test('integration wiring keeps search private and as real tool-call pass, not fake public claims', () => {
  const source = readFileSync(new URL('../src/chat.ts',import.meta.url),'utf8');
  const client = readFileSync(new URL('../public/assets/js/app.js',import.meta.url),'utf8');
  assert.match(source,/tools: \[SEARCH_CHAT_HISTORY_TOOL\]/);
  assert.match(source,/tool_choice: 'required'/);
  assert.match(source,/verifiedHistoryOwner\(request, env, requestBody.value.userId!\)/);
  assert.match(source,/searchChatHistory\(supabase as unknown as SupabaseClient/);
  assert.match(source,/historyResultForModel\(result\)/);
  assert.match(source,/&& !historyIntent/);
  assert.match(client,/step === 'history'/);
  assert.doesNotMatch(source,/console\.log\(.*historyResultForModel/);
});
