import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base=process.env.CLOUD_TEST_URL||'http://localhost:4186';
const password=process.env.CLOUD_TEST_PASSWORD||'browser-test-password';
const sessions={};
const call=async(route,{user,method='GET',data,origin=base}={})=>{
 const r=await fetch(base+route,{method,headers:{...(sessions[user]?{Cookie:sessions[user]}:{}),...(method==='POST'?{'Content-Type':'application/json','X-Requested-With':'ApprovalWorkspace',Origin:origin}:{})},body:data===undefined?undefined:JSON.stringify(data)});
 const text=await r.text();let body;try{body=JSON.parse(text);}catch{body=text;}
 return {status:r.status,headers:r.headers,body};
};
const login=async name=>{const r=await call('/api/auth/login',{method:'POST',data:{username:name,password}});assert.equal(r.status,200,JSON.stringify(r.body));sessions[name]=r.headers.get('set-cookie').split(';')[0];assert.match(r.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);};
const read=user=>call('/api/workspace',{user});
const cmd=async(user,input)=>call('/api/workspace/command',{user,method:'POST',data:{revision:(await read(user)).body.revision,...input}});
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
const pass=s=>console.log('PASS:',s);
assert.equal((await call('/api/workspace')).status,401);
for(const name of ['Kate','Hassan Kassem','Lewis'])await login(name);
assert.equal((await read('Kate')).body.state.environment,'qa','Destructive QA checks must never run against production.');
for(const url of ['/.local/accounts.json','/cloud/auth.mjs','/wrangler.jsonc','/server.mjs'])assert.equal((await call(url)).status,404);
assert.equal((await call('/api/workspace/command',{user:'Kate',method:'POST',origin:'https://evil.invalid',data:{}})).status,403);
pass('Private server files and workspace are protected; cross-origin writes fail');
const project={name:'QA concurrency '+Date.now(),pm:'taylor',director:'sam',threshold:10000};
const revision=(await read('Kate')).body.revision;
const concurrent=await Promise.all([1,2].map(i=>call('/api/workspace/command',{user:'Kate',method:'POST',data:{revision,operation:'project',data:{...project,name:project.name+' '+i}}})));
assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
assert.equal((await read('Kate')).body.state.business.projects.filter(p=>p.name.startsWith(project.name)).length,1);
pass('Concurrent D1 transactions commit exactly once; stale writes return 409');
const receipt={name:'qa-receipt.txt',type:'text/plain',size:10,data:'data:text/plain;base64,'+Buffer.from('QA receipt').toString('base64')};
const r=ok(await cmd('Hassan Kassem',{operation:'request',actor:'alex',submit:true,data:{kind:'corporation',amount:50,invoiceDate:'2026-10-22',requester:'alex',attachments:[receipt]}})).result;
assert.equal(r.requester,'taylor');assert.match(r.attachments[0].data,/^\/api\/files\//);
assert.equal((await call(r.attachments[0].data)).status,401);
const download=await call(r.attachments[0].data,{user:'Kate'});assert.equal(download.status,200);assert.equal(download.body,'QA receipt');assert.match(download.headers.get('content-disposition'),/^attachment;/);
const stored=ok(await read('Lewis')).state.business.requests.find(v=>v.id===r.id);assert.equal(stored.attachments[0].data,r.attachments[0].data);assert.ok(!JSON.stringify(stored).includes('data:text/plain;base64'));
assert.equal((await cmd('Hassan Kassem',{operation:'action',id:r.id,action:'approve',actor:'alex'})).status,400);
ok(await cmd('Kate',{operation:'action',id:r.id,action:'approve'}));
assert.equal(ok(await cmd('Lewis',{operation:'action',id:r.id,action:'approve'})).result.stage,'Ready to pay');
assert.equal((await cmd('Hassan Kassem',{operation:'request',data:{kind:'corporation',amount:10,invoiceDate:'2026-10-22',attachments:[{...receipt,data:'/api/files/00000000-0000-4000-8000-000000000000'}]}})).status,400);
pass('R2 attachments persist as private references; downloads require login; actor spoofing and self-approval fail');
for(const [name,type] of [['invoice-text.pdf','application/pdf'],['invoice-image.png','image/png'],['invoice-scanned.pdf','application/pdf']]){
 const data=(await fs.readFile(new URL('./fixtures/'+name,import.meta.url))).toString('base64');
 const scan=ok(await call('/api/invoice/scan',{user:'Kate',method:'POST',data:{name,data}}));
 assert.equal(scan.fields.total,1320,JSON.stringify(scan));assert.equal(scan.fields.date,'2026-10-16');
 pass('Cloud OCR reads '+name+' amount and date');
}
const old=sessions.Kate;ok(await call('/api/auth/logout',{user:'Kate',method:'POST',data:{}}));sessions.Kate=old;
assert.equal((await call(r.attachments[0].data,{user:'Kate'})).status,401);
assert.equal((await read('Lewis')).status,200);
pass('D1 logout revokes both data and file access without affecting other users');
