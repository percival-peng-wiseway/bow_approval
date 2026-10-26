// Remote QA only. Creates synthetic records, disables the test customer afterwards,
// and reads its queued invitation directly from QA D1. No email is sent.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const base=process.env.CLOUD_TEST_URL||'https://bow-approval-qa.percival-0ae.workers.dev';
assert.equal(new URL(base).hostname,'bow-approval-qa.percival-0ae.workers.dev');
assert.ok(process.env.CLOUD_TEST_PASSWORD,'Set CLOUD_TEST_PASSWORD');
const sessions={},tag='Customer QA '+Date.now();let customer;
const call=async(route,user,data)=>{const r=await fetch(base+route,{method:data?'POST':'GET',headers:{...(sessions[user]?{Cookie:sessions[user]}:{}),...(data?{'Content-Type':'application/json',Origin:base,'X-Requested-With':'ApprovalWorkspace'}:{})},body:data?JSON.stringify(data):undefined});const text=await r.text();let body;try{body=JSON.parse(text);}catch{body=text;}return {status:r.status,body,cookie:r.headers.get('set-cookie')?.split(';')[0]};};
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
const cmd=async(user,input)=>call('/api/workspace/command',user,{revision:ok(await call('/api/workspace',user)).revision,...input});
const pass=s=>console.log('PASS:',s);
try{
 for(const user of ['Kate','Hassan Kassem','Joe']){const r=await call('/api/auth/login',null,{username:user,password:process.env.CLOUD_TEST_PASSWORD});ok(r);sessions[user]=r.cookie;}
 assert.equal(ok(await call('/api/workspace','Kate')).state.environment,'qa');
 assert.equal(ok(await call('/api/customer/admin','Kate')).configured,false,'This test must run with email delivery disabled.');
 customer=ok(await cmd('Kate',{operation:'customer',data:{name:tag,email:'qa-'+Date.now()+'@example.invalid'}})).result;
 const project=ok(await cmd('Kate',{operation:'project',data:{name:tag,pm:'taylor',director:'sam',threshold:10000,customerId:customer.id}})).result;
 const receipt={name:'private-qa.txt',type:'text/plain',size:19,data:'data:text/plain;base64,'+Buffer.from('Private QA document').toString('base64')};
 const r=ok(await cmd('Hassan Kassem',{operation:'request',submit:true,data:{kind:'service',projectId:project.id,title:tag,background:'Synthetic site',purpose:'Synthetic survey',approach:'Test scope',amount:1000,attachments:[receipt]}})).result;
 assert.equal(r.stage,'Customer confirmation');assert.match(r.attachments[0].data,/^\/api\/files\//);
 assert.equal((await cmd('Joe',{operation:'action',id:r.id,action:'approve'})).status,400);
 pass('QA D1 persists customer/project links and gates internal approval');
 ok(await call('/api/customer/invite','Kate',{id:customer.id}));
 assert.match(customer.id,/^customer-[a-f0-9-]{36}$/);
 const sql="SELECT payload FROM customer_mail WHERE json_extract(payload,'$.customerId')='"+customer.id+"' AND json_extract(payload,'$.kind')='access' ORDER BY rowid DESC LIMIT 1";
 const rows=JSON.parse(execFileSync('node_modules/.bin/wrangler',['d1','execute','DB','--env','QA','--remote','--json','--command',sql],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
 const token=JSON.parse(rows[0].results[0].payload).text.match(/#access=([a-f0-9]{64})/)[1];
 const attempts=await Promise.all([1,2].map(()=>call('/api/customer/access',null,{token})));
 assert.deepEqual(attempts.map(x=>x.status).sort(),[200,400]);sessions.customer=attempts.find(x=>x.status===200).cookie;
 const view=ok(await call('/api/customer/workspace','customer'));
 assert.equal(view.projects.length,1);assert.equal(view.projects[0].id,project.id);
 assert.equal(view.projects[0].requests[0].review.snapshot.amount,1000);
 assert.ok(!JSON.stringify(view).includes(r.attachments[0].data));
 for(const route of ['/api/workspace','/api/customer/admin',r.attachments[0].data])assert.equal((await call(route,'customer')).status,403);
 pass('D1 sign-in token is single-use under concurrency; customer cannot read internal APIs or private R2 files');
 const decision={revision:view.revision,id:r.id,reviewId:r.customerReview.id,decision:'approve',comment:'Synthetic QA confirmation'};
 ok(await call('/api/customer/decision','customer',decision));assert.equal((await call('/api/customer/decision','customer',decision)).status,409);
 assert.equal(ok(await call('/api/workspace','Kate')).state.business.requests.find(x=>x.id===r.id).stage,'Budget review');
 pass('Customer confirmation advances to internal pre-approval exactly once');
 const mail=ok(await call('/api/customer/admin','Kate')).mail;
 assert.ok(!JSON.stringify(mail).includes(token));assert.ok(!JSON.stringify(mail).includes('#access='));
 pass('Admin mail records redact sign-in secrets; email remains queued');
}finally{
 if(customer){ok(await cmd('Kate',{operation:'customer',data:{...customer,active:false}}));if(sessions.customer)assert.equal((await call('/api/customer/workspace','customer')).status,403);pass('Synthetic customer disabled; subsequent access is denied');}
 for(const user of Object.keys(sessions))await call('/api/auth/logout',user,{});
}
