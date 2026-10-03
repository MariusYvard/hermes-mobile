import test from 'node:test';
import assert from 'node:assert/strict';
let createClient;
try { ({createClient} = await import('./client.mjs')); } catch {}
test('origin validation rejects unsafe inputs without leaking credentials', () => {
  assert.equal(typeof createClient, 'function');
  for (const origin of ['http://example.com','https://user:secret@example.com','https://example.com/a','https://example.com?x','https://example.com#x',' https://example.com','http://127.1','https://example.com/../']) {
    assert.throws(() => createClient({origin, token:'ephemeral-marker'}), error => error.code === 'invalid_url' && !String(error).includes('secret') && !JSON.stringify(error).includes('ephemeral-marker'));
  }
  for (const origin of ['https://example.com','http://127.0.0.1:1','http://localhost:1','http://[::1]:1']) assert.equal(typeof createClient({origin}).capabilities,'function');
});

import {createServer} from 'node:http';
const caps = {object:'hermes.api_server.capabilities',platform:'hermes-agent',auth:{type:'bearer',required:true},features:{session_resources:true},endpoints:{sessions:{method:'GET',path:'/api/sessions'},session_create:{method:'POST',path:'/api/sessions'},session:{method:'GET',path:'/api/sessions/{session_id}'}}};
async function fixture(handler, run) {
  const server = createServer(handler); await new Promise(r => server.listen(0,'127.0.0.1',r));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
}
const json = (res, body, status=200) => {res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
test('older discovery cannot restore capabilities after newer auth failure', async () => {
  let firstResponse, signalFirst;
  const firstArrived = new Promise(resolve => { signalFirst = resolve; });
  await fixture((req, res) => {
    if (!firstResponse) { firstResponse = res; signalFirst(); }
    else json(res, {}, 401);
  }, async origin => {
    const c = createClient({origin});
    const old = c.capabilities();
    const stale = assert.rejects(old, {code:'stale_discovery'});
    await firstArrived;
    await assert.rejects(c.capabilities(), {code:'unauthorized'});
    json(firstResponse, caps);
    await stale;
    await assert.rejects(c.listSessions(), {code:'capabilities_required'});
  });
});
test('existing dotted and long session IDs remain readable while creation stays narrow', async () => {
  for (const id of ['20261003_120000_ab.cd', 'a'.repeat(256)]) {
    await fixture((req, res) => {
      if (req.url === '/v1/capabilities') return json(res, caps);
      if (req.url === '/api/sessions') return json(res, {object:'list',data:[{id}],has_more:false});
      assert.equal(req.url, '/api/sessions/' + encodeURIComponent(id));
      json(res, {object:'hermes.session',session:{id}});
    }, async origin => {
      const c = createClient({origin}); await c.capabilities();
      assert.equal((await c.listSessions()).data[0].id, id);
      assert.equal((await c.getSession(id)).id, id);
      await assert.rejects(c.createSession({id,title:'fixture'}), {code:'invalid_input'});
    });
  }
});
test('known session-not-found differs from a missing transport', async () => {
  await fixture((req,res) => {
    if (req.url === '/v1/capabilities') return json(res,caps);
    return json(res,{error:{code:'session_not_found',message:'PRIVATE_CONTENT'}},404);
  }, async origin => {
    const c = createClient({origin}); await c.capabilities();
    await assert.rejects(c.getSession('missing'), e => e.code==='session_not_found' && !JSON.stringify(e).includes('PRIVATE'));
  });
});
test('authenticated capabilities have narrow validated output', async () => {
  await fixture((req,res) => { assert.equal(req.url,'/v1/capabilities'); assert.equal(req.headers.authorization,'Bearer ephemeral-marker'); json(res,caps); }, async origin => {
    const c=createClient({origin,token:'ephemeral-marker'}); assert.deepEqual(await c.capabilities(),{session_resources:true}); assert.equal(JSON.stringify(c).includes('ephemeral-marker'),false);
  });
});

test('sessions list create detail are capability gated and projected', async () => {
  const rows=[];
  await fixture((req,res) => {
    if(req.url==='/v1/capabilities') return json(res,caps);
    if(req.url==='/api/sessions' && req.method==='GET') return json(res,{object:'list',data:rows,has_more:false,limit:50,offset:0});
    if(req.method==='POST') { let body=''; req.on('data',c=>body+=c); req.on('end',()=>{rows.push(JSON.parse(body));json(res,{object:'hermes.session',session:{...rows[0],private_field:'not-projected'}},201);});return; }
    json(res,{object:'hermes.session',session:rows[0]});
  },async origin=> {
    const c=createClient({origin,token:'ephemeral-marker'});
    await assert.rejects(c.listSessions(),{code:'capabilities_required'});
    await c.capabilities(); assert.deepEqual(await c.listSessions(),{data:[],has_more:false});
    const created=await c.createSession({id:'fixture-005',title:'SYNTHETIC 005'});assert.deepEqual(created,{id:'fixture-005',title:'SYNTHETIC 005'});
    assert.deepEqual(await c.getSession('fixture-005'),created);assert.equal((await c.listSessions()).data.length,1);
    await assert.rejects(c.getSession('../bad'),{code:'invalid_input'});
  });
});
test('unadvertised sessions endpoint sends nothing',async()=>{
  let calls=0;await fixture((req,res)=>{calls++;json(res,{...caps,endpoints:{}});},async origin=>{
    const c=createClient({origin});await c.capabilities();await assert.rejects(c.listSessions(),{code:'unsupported_capability'});assert.equal(calls,1);
  });
});

for (const [status, code] of [[301,'redirect_blocked'],[401,'unauthorized'],[403,'forbidden'],[404,'unsupported_transport'],[409,'conflict'],[500,'http_error']]) test(`HTTP ${status} sanitized`,async()=>{
  await fixture((req,res)=>{res.writeHead(status,{Location:'http://localhost:1/steal'});res.end('ephemeral-marker private-body');},async origin=>{
    await assert.rejects(createClient({origin,token:'ephemeral-marker'}).capabilities(),err=>err.code===code && !JSON.stringify(err).includes('marker') && !String(err).includes('private-body'));
  });
});
for (const [body,code] of [['not json','invalid_json'],[JSON.stringify({}), 'invalid_contract'],[JSON.stringify({...caps,auth:{required:false}}),'insecure_auth']]) test(code,async()=>{
  await fixture((req,res)=>res.end(body),async origin=>await assert.rejects(createClient({origin}).capabilities(),{code}));
});
test('JSON bytes and body stall bounded',async()=>{
  await fixture((req,res)=>res.end('x'.repeat(1000)),async origin=>await assert.rejects(createClient({origin,maxBytes:128}).capabilities(),{code:'response_too_large'}));
  await fixture((req,res)=>{res.writeHead(200);res.write('{');},async origin=>await assert.rejects(createClient({origin,timeoutMs:40}).capabilities(),{code:'timeout'}));
});
test('options validated without leaking token',()=>{
  for(const opt of [{timeoutMs:0},{timeoutMs:NaN},{timeoutMs:2147483648},{maxBytes:0},{token:'bad\r\nsecret'},{token:{secret:true}}]) assert.throws(()=>createClient({origin:'https://example.com',...opt}),{code:'invalid_options'});
});
test('network errors sanitized',async()=>{
  await assert.rejects(createClient({origin:'http://127.0.0.1:1',token:'ephemeral-marker'}).capabilities(),{code:'unreachable'});
});
test('foreign endpoint never receives credential and POST never retries',async()=>{
  let foreignCalls=0;await fixture((req,res)=>{foreignCalls++;json(res,caps);},async foreign=>{
    let posts=0;await fixture((req,res)=>{
      if(req.url==='/v1/capabilities')return json(res,{...caps,endpoints:{...caps.endpoints,sessions:{method:'GET',path:foreign+'/api/sessions'}}});
      if(req.method==='POST'){posts++;res.destroy();return;}
      throw Error('unexpected request');
    },async origin=>{
      const c=createClient({origin,token:'ephemeral-marker'});await c.capabilities();await assert.rejects(c.listSessions(),{code:'unsupported_capability'});
      await assert.rejects(c.createSession({id:'fixture',title:'SYNTHETIC'}),{code:'unreachable'});assert.equal(posts,1);
    });assert.equal(foreignCalls,0);
  });
});

test('arrays are not capability records',async()=>{
  for(const bad of [{...caps,features:[]},{...caps,endpoints:[]}]) await fixture((req,res)=>json(res,bad),async origin=>await assert.rejects(createClient({origin}).capabilities(),{code:'invalid_contract'}));
});
test('malformed session rows denied',async()=>{
  for(const row of [null,[],{id:123},{id:'fixture',title:42}]) await fixture((req,res)=>json(res,req.url==='/v1/capabilities'?caps:{object:'list',data:[row],has_more:false}),async origin=>{
    const c=createClient({origin});await c.capabilities();await assert.rejects(c.listSessions(),{code:'invalid_session_contract'});
  });
});
test('redirect destination is never contacted',async()=>{
  let hits=0;await fixture((req,res)=>{hits++;json(res,caps);},async target=>{
    await fixture((req,res)=>{res.writeHead(307,{Location:target+'/v1/capabilities'});res.end();},async origin=>await assert.rejects(createClient({origin,token:'ephemeral-marker'}).capabilities(),{code:'redirect_blocked'}));
  });assert.equal(hits,0);
});

for (const olderStatus of [200,500]) test(`new discovery survives older ${olderStatus} completion`,async()=>{
  let oldResponse,signal;const arrived=new Promise(resolve=>{signal=resolve;});
  await fixture((req,res)=>{
    if(req.url!=='/v1/capabilities')return json(res,{object:'list',data:[],has_more:false});
    if(!oldResponse){oldResponse=res;signal();return;}
    json(res,caps);
  },async origin=>{
    const c=createClient({origin});const old=c.capabilities();
    const rejected=assert.rejects(old,{code:olderStatus===200?'stale_discovery':'http_error'});
    await arrived;await c.capabilities();json(oldResponse,caps,olderStatus);await rejected;
    assert.deepEqual(await c.listSessions(),{data:[],has_more:false});
  });
});
test('read policy rejects path hazards before sending and counts Unicode codepoints',async()=>{
  let calls=0;
  const id='é😀'.repeat(128);
  await fixture((req,res)=>{
    calls++;if(req.url==='/v1/capabilities')return json(res,caps);
    assert.equal(req.url,'/api/sessions/'+encodeURIComponent(id));
    json(res,{object:'hermes.session',session:{id}});
  },async origin=>{
    const c=createClient({origin});await c.capabilities();
    for(const bad of ['.','..','../a','a..b','a/b','a\\b','C:drive','z:\\drive','a\r','a\n','a\0','a'.repeat(257),'😀'.repeat(257)])await assert.rejects(c.getSession(bad),{code:'invalid_input'});
    assert.equal(calls,1);assert.equal((await c.getSession(id)).id,id);assert.equal(calls,2);
  });
});
test('encoded literal percent and dot segments do not undergo URL canonicalization',async()=>{
  for(const id of ['a.b','%2e','%2e%2e','%2f','雪 ?#%'])await fixture((req,res)=>{
    if(req.url==='/v1/capabilities')return json(res,caps);
    assert.equal(req.url,'/api/sessions/'+encodeURIComponent(id));json(res,{object:'hermes.session',session:{id}});
  },async origin=>{const c=createClient({origin});await c.capabilities();assert.equal((await c.getSession(id)).id,id);});
});
test('Unicode drive prefix matches backend path safety before HTTP',async()=>{
  let calls=0;
  await fixture((req,res)=>{calls++;json(res,req.url==='/v1/capabilities'?caps:{object:'hermes.session',session:{id:'é:drive'}});},async origin=>{
    const c=createClient({origin});await c.capabilities();
    await assert.rejects(c.getSession('é:drive'),{code:'invalid_input'});
    assert.equal(calls,1);
  });
});
test('unencodable Unicode is a stable sanitized input error, not URIError',async()=>{
  let calls=0;
  await fixture((req,res)=>{calls++;json(res,caps);},async origin=>{
    const c=createClient({origin,token:'ephemeral-marker'});await c.capabilities();
    for(const id of ['\ud800','\udfff','valid\ud800'])await assert.rejects(c.getSession(id),error=>error.code==='invalid_input' && error.name==='ConnectionError' && !JSON.stringify(error).includes('ephemeral-marker'));
    assert.equal(calls,1);
  });
});
test('unknown or invalid session 404 is bounded and sanitized',async()=>{
  for(const body of ['private-body',JSON.stringify({error:{code:'unknown',message:'PRIVATE'}}),JSON.stringify({code:'session_not_found'})])await fixture((req,res)=>{
    if(req.url==='/v1/capabilities')return json(res,caps);res.writeHead(404);res.end(body);
  },async origin=>{
    const c=createClient({origin});await c.capabilities();await assert.rejects(c.getSession('missing'),error=>error.code==='unsupported_transport' && error.status===404 && !String(error).includes('PRIVATE') && !JSON.stringify(error).includes('private'));
  });
});
test('session 404 declared bytes, streamed bytes and stalled body remain bounded',async()=>{
  for(const mode of ['declared','streamed','stall'])await fixture((req,res)=>{
    if(req.url==='/v1/capabilities')return json(res,caps);
    res.writeHead(404,mode==='declared'?{'Content-Length':'2000'}:{});
    if(mode==='stall')res.write('{');else res.end('x'.repeat(2000));
  },async origin=>{
    const c=createClient({origin,maxBytes:1024,timeoutMs:1000});await c.capabilities();
    await assert.rejects(c.getSession('missing'),{code:mode==='stall'?'timeout':'response_too_large'});
  });
});
