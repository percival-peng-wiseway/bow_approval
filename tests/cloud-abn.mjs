import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base=process.env.CLOUD_TEST_URL,password=process.env.CLOUD_TEST_PASSWORD;
assert.ok(base&&password,'Set QA URL and test password');
const sessions={};
async function call(route,user,data){const r=await fetch(base+route,{method:data?'POST':'GET',headers:{...(sessions[user]?{Cookie:sessions[user]}:{}),...(data?{'Content-Type':'application/json',Origin:base,'X-Requested-With':'ApprovalWorkspace'}:{})},body:data?JSON.stringify(data):undefined});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')};}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
assert.equal(ok(await call('/api/health')).environment,'qa','Synthetic requests are QA only');
for(const user of ['Kate','Hassan Kassem','Lewis','Joe'])sessions[user]=okLogin(await call('/api/auth/login',null,{username:user,password}));
function okLogin(r){ok(r);return r.cookie.split(';')[0];}
const cmd=async(user,input)=>call('/api/workspace/command',user,{revision:ok(await call('/api/workspace',user)).revision,...input});
const project=ok(await cmd('Kate',{operation:'project',data:{name:'QA ABN '+Date.now(),pm:'taylor',director:'sam',threshold:10000}})).result;
const r=ok(await cmd('Hassan Kassem',{operation:'request',submit:true,data:{kind:'service',projectId:project.id,title:'QA ABN contract verification',background:'Synthetic test',purpose:'Verify supplier checking',approach:'Test official lookup and private files',amount:1000,attachments:[]}})).result;
for(const user of ['Joe','Lewis'])ok(await cmd(user,{operation:'action',id:r.id,action:'approve'}));
const supplier='B P AUSTRALIA PTY LTD';
const contract={name:'qa-contract.txt',type:'text/plain',data:'data:text/plain;base64,'+Buffer.from('Synthetic test contract\nSupplier: '+supplier+'\nABN: 53 004 085 616').toString('base64')};
const input={requestId:r.id,supplier,files:[contract]};
assert.equal((await call('/api/contracts/check-abn','Kate',input)).status,403);
const check=ok(await call('/api/contracts/check-abn','Hassan Kassem',input));assert.equal(check.status,'checked',JSON.stringify(check));assert.equal(check.entries[0].source,'official');assert.equal(check.entries[0].gstRegistered,true);
console.log('PASS: Cloud official lookup verifies matching supplier, active ABN and GST');
const source={operation:'action',id:r.id,action:'source',data:{quotes:[{supplier,amount:1000,quoteFiles:[contract],contractFiles:[contract]}],selectedIndex:0,reason:'Synthetic QA test'}};
assert.equal((await cmd('Hassan Kassem',structuredClone(source))).status,400);
source.data.quotes[0].abnCheckId=check.id;
const tampered=structuredClone(source);tampered.data.quotes[0].contractFiles[0].data='data:text/plain;base64,YQ==';assert.equal((await cmd('Hassan Kassem',tampered)).status,400);
const pdf={name:'invoice-text.pdf',type:'application/pdf',data:'data:application/pdf;base64,'+(await fs.readFile(new URL('./fixtures/invoice-text.pdf',import.meta.url))).toString('base64')};
const scan=ok(await call('/api/contracts/check-abn','Hassan Kassem',{...input,files:[pdf]}));assert.ok(scan.detected.includes('12345678901'),JSON.stringify(scan));assert.equal(scan.status,'review');console.log('PASS: Cloud PDF OCR extracts ABN and marks invalid ABN for review');
const result=ok(await cmd('Hassan Kassem',source)).result;const saved=result.quotes[0];assert.equal(saved.abnCheck.id,check.id);assert.match(saved.contractFiles[0].data,/^\/api\/files\//);assert.equal(saved.abnCheck.status,'checked');
console.log('PASS: Unchecked and replaced contracts blocked; trusted check persisted beside private R2 contract');
ok(await cmd('Lewis',{operation:'action',id:r.id,action:'return',data:{reason:'QA recheck existing R2 file'}}));
// Returned requests resume their sourcing stage when the applicant resubmits.
ok(await cmd('Hassan Kassem',{operation:'action',id:r.id,action:'submit'}));
const recheck=ok(await call('/api/contracts/check-abn','Hassan Kassem',{...input,files:saved.contractFiles}));assert.equal(recheck.status,'checked');assert.equal(recheck.fingerprint,check.fingerprint);
console.log('PASS: Existing R2 attachments can be rechecked with the same document fingerprint');
for(const user of Object.keys(sessions))ok(await call('/api/auth/logout',user,{}));
