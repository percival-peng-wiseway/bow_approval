import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {provisionAccounts,provisionAdminAccount,openAuth} from '../server/auth.mjs';
import {isAdmin,canManageWorkflows} from '../app/domain.mjs';
import {applyCommand} from '../server/commands.mjs';
import {initialDesign,saveApprovalDesign} from '../app/approval-design.mjs';
test('dedicated admin has its own credentials, management rights and audit identity',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bow-admin-'));
 try{
  await provisionAccounts(dir,'existing-test-password');
  const before=JSON.parse(await fs.readFile(path.join(dir,'accounts.json'),'utf8'));
  await provisionAdminAccount(dir,'admin-test-password');
  const auth=await openAuth(dir),session=await auth.login('admin','admin-test-password','local');
  assert.equal(session.user.id,'admin');assert.equal(session.user.role,'Admin');assert.ok(isAdmin('admin'));assert.ok(canManageWorkflows('admin'));
  assert.equal((await auth.login('Kate','existing-test-password','local')).user.id,'alex');
  const saved=await fs.readFile(path.join(dir,'accounts.json'),'utf8');assert.ok(!saved.includes('admin-test-password'));assert.deepEqual(JSON.parse(saved).slice(0,before.length),before);
  await assert.rejects(provisionAdminAccount(dir,'replacement-password'),/already exists/);
  const s={business:{projects:[],requests:[],customers:[]}};
  const p=applyCommand(s,'admin',{operation:'project',data:{name:'Admin project',pm:'taylor',director:'sam'}});assert.equal(p.history[0].actor,'admin');
  const invite=applyCommand(s,'admin',{operation:'project-customer',projectId:p.id,data:{name:'Test customer',contact:'Test',email:'test@example.com'}});assert.equal(invite.project.customerId,invite.customer.id);
  const design=saveApprovalDesign(s,'admin',{graph:initialDesign('service',p),projectId:p.id,expectedVersion:0});assert.equal(design.status,'draft');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('only dedicated admin can delegate; request, supplier, contract and Finance steps retain real operator audit',async()=>{
 const {once}=await import('node:events'),{createWorkspaceServer}=await import('../server.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bow-admin-delegate-'));let server;
 try{
  await provisionAccounts(dir,'staff-test-password');await provisionAdminAccount(dir,'admin-test-password');
  server=await createWorkspaceServer({dataDir:dir,mailEnv:{}});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
  const call=async(route,cookie,data,as)=>{const response=await fetch(base+route,{method:data?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(as?{'X-Act-As':as}:{}),...(data?{Origin:base,'Content-Type':'application/json','X-Requested-With':'ApprovalWorkspace'}:{})},body:data?JSON.stringify(data):undefined});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
  const admin=(await call('/api/auth/login',null,{username:'admin',password:'admin-test-password'})).cookie;
  const kate=(await call('/api/auth/login',null,{username:'Kate',password:'staff-test-password'})).cookie;
  assert.equal((await call('/api/workspace',kate,undefined,'sam')).status,403);
  for(const invalid of ['employee','missing','customer-a'])assert.equal((await call('/api/workspace',admin,undefined,invalid)).status,400);
  assert.equal((await call('/api/auth/me',admin,undefined,'jamie')).body.user.id,'admin');
  assert.equal((await call('/api/workspace',admin,undefined,'jamie')).body.state.actor,'jamie');
  assert.equal((await call('/api/workspace',admin)).body.state.actor,'admin');
  let revision=0;const command=async(input,as)=>{const out=await call('/api/workspace/command',admin,{...input,revision},as);if(out.status===200)revision=out.body.revision;return out;};
  let out=await command({operation:'project',data:{name:'Delegated project',pm:'taylor',director:'sam',members:['director-c']}});assert.equal(out.status,200);const projectId=out.body.result.id;
  out=await command({operation:'request',submit:true,data:{kind:'service',payingEntity:'Test Development Pty Ltd',projectId,title:'Delegated survey',background:'Site work',approach:'Report',amount:1000}},'director-c');assert.equal(out.status,200);const id=out.body.result.id;
  assert.equal(out.body.result.requester,'director-c');assert.equal(out.body.result.history[0].performedBy,'admin');
  assert.equal((await command({operation:'action',id,action:'approve'},'director-c')).status,400);
  await command({operation:'action',id,action:'approve'},'sam');out=await command({operation:'action',id,action:'approve'},'jamie');assert.equal(out.body.result.stage,'Sourcing');
  const file={name:'synthetic-contract.txt',data:'data:text/plain;base64,YQ==',size:1};
  await command({operation:'action',id,action:'source',data:{quotes:[{supplier:'Test supplier',amount:1000,quoteFiles:[file]}],selectedIndex:0,reason:'Qualified'}},'director-c');
  await command({operation:'action',id,action:'approve'},'sam');out=await command({operation:'action',id,action:'approve'},'jamie');assert.equal(out.body.result.stage,'Contract preparation');
  assert.equal((await command({operation:'action',id,action:'contract',data:{files:[file],amount:1000,submit:true}},'taylor')).status,400);
  out=await command({operation:'action',id,action:'contract',data:{files:[file],amount:1000,submit:true}},'director-c');assert.equal(out.body.result.stage,'Contract review');
  out=await command({operation:'action',id,action:'approve'},'jamie');assert.equal(out.body.result.stage,'Contract signing');
  assert.ok(out.body.result.history.every(e=>e.performedBy==='admin'));assert.match(out.body.result.history.at(-1).detail,/admin on behalf of Lewis/);
  assert.equal(out.body.state.adminActions.at(-1).actingAs,'jamie');assert.equal(out.body.state.adminActions.at(-1).performedBy,'admin');
  out=await command({operation:'action',id,action:'sign-contract',data:{files:[file],signatory:'Test signatory',signedDate:'2026-10-25',authorityConfirmed:true}},'director-c');assert.equal(out.status,200);assert.equal(out.body.result.stage,'Invoice preparation');assert.equal(out.body.result.history.at(-1).performedBy,'admin');
  const fake=await call('/api/workspace/command',kate,{revision,operation:'project',performedBy:'admin',data:{name:'Kate project',pm:'taylor',director:'sam'}});assert.equal(fake.status,200);assert.equal(fake.body.result.history[0].performedBy,undefined);
  const audit=await fs.readFile(path.join(dir,'admin-actions.jsonl'),'utf8');assert.match(audit,/"performedBy":"admin"/);assert.ok(!audit.includes('staff-test-password'));
 }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
});
