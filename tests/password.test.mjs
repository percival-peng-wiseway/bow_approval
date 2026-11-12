import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {localRequest} from './helpers/local-request.mjs';
import {registerHooks} from 'node:module';
import {provisionAccounts,openAuth} from '../server/auth.mjs';
import {createWorkspaceServer} from '../server.mjs';
import {users} from '../app/domain.mjs';
import {passwordError} from '../app/password-policy.mjs';
import {testD1} from './helpers/d1.mjs';
// The OCR Container requires the Worker runtime; password routes do not use it.
const hooks=registerHooks({resolve(specifier,context,next){if(specifier==='@cloudflare/containers')return {url:'data:text/javascript,export class Container {}',shortCircuit:true};return next(specifier,context);}});
const {default:worker}=await import('../cloud/worker.mjs');hooks.deregister();
const original='Original-Test-12!',updated='Updated-Test-34!',temporary='Temporary-Test-56!';
async function fixture(kind){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bow-password-'));await provisionAccounts(dir,original);
 let server,db,base='https://approval.test';
 if(kind==='local'){server=await createWorkspaceServer({dataDir:dir});base='http://127.0.0.1:4185';}
 else{db=await testD1();for(const a of JSON.parse(await fs.readFile(path.join(dir,'accounts.json'),'utf8')))await db.prepare('INSERT INTO accounts(id,username,normalized_name,role,salt,password_hash) VALUES(?,?,?,?,?,?)').bind(a.id,a.username,a.username.toLowerCase(),users.find(u=>u.id===a.id).role,a.salt,a.hash).run();}
 const call=async(route,{cookie,method='GET',data,headers={}}={})=>{const init={method,headers:{...(cookie?{Cookie:cookie}:{}),...(method==='POST'?{Origin:base,'Content-Type':'application/json','X-Requested-With':'ApprovalWorkspace'}:{}),...headers},body:data===undefined?undefined:JSON.stringify(data)};const response=server?await localRequest(server,base+route,init):await worker.fetch(new Request(base+route,init),{DB:db},{waitUntil(){}});return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};};
 const login=async(name,password=original)=>call('/api/auth/login',{method:'POST',data:{username:name,password}});
 return {dir,db,call,login,async close(){if(server)server.emit('close');db?.close();await fs.rm(dir,{recursive:true,force:true});}};
}
test('shared password policy bounds, complexity and confirmation',()=>{for(const p of ['short','abcdefghijklmnop','ABCDEFGHIJKL','123456789012','a'.repeat(129),null])assert.ok(passwordError(p,p));assert.ok(passwordError(updated,'different'));assert.equal(passwordError(updated,updated),'');});
for(const kind of ['local','cloud']){
 test(`${kind}: password change, reset, forced change, session isolation, persistence and authorization`,async()=>{
  const f=await fixture(kind);try{
   const {call,login}=f;let joe=await login('Joe'),other=await login('Joe'),admin=await login('Kate'),lewis=await login('Lewis');
   const change=(cookie,data,headers)=>call('/api/auth/change-password',{method:'POST',cookie,data,headers});
   const reset=(cookie,data,headers)=>call('/api/admin/reset-password',{method:'POST',cookie,data,headers});
   const data={currentPassword:original,newPassword:updated,confirmPassword:updated};
   assert.equal((await change(undefined,data)).status,401);
   assert.equal((await reset(joe.cookie,{accountId:'jamie'})).status,403);
   for(const headers of [{Origin:'https://evil.test'},{'Content-Type':'text/plain'},{'X-Requested-With':''}]){
    assert.equal((await change(joe.cookie,data,headers)).status,403);assert.equal((await reset(admin.cookie,{accountId:'sam'},headers)).status,403);
   }
   assert.equal((await change(joe.cookie,null)).status,400);
   assert.equal((await change(joe.cookie,{...data,currentPassword:'wrong'})).status,400);
   assert.equal((await change(joe.cookie,{...data,newPassword:'weak',confirmPassword:'weak'})).status,400);
   assert.equal((await change(joe.cookie,{...data,confirmPassword:'different'})).status,400);
   assert.equal((await change(joe.cookie,{...data,newPassword:original,confirmPassword:original})).status,400);
   const changed=await change(joe.cookie,{...data,accountId:'jamie'});assert.equal(changed.status,200);assert.equal(changed.body.user.mustChangePassword,false);assert.ok(changed.cookie);
   for(const cookie of [joe.cookie,other.cookie])assert.equal((await call('/api/auth/me',{cookie})).status,401);
   assert.equal((await call('/api/auth/me',{cookie:changed.cookie})).status,200);assert.equal((await call('/api/auth/me',{cookie:lewis.cookie})).status,200);
   assert.equal((await login('Joe')).status,401);assert.equal((await login('Joe',updated)).status,200);
   assert.equal((await reset(admin.cookie,{accountId:'alex'})).status,400);assert.equal((await reset(admin.cookie,{accountId:'missing'})).status,404);
   assert.equal((await reset(admin.cookie,{accountId:'sam',temporaryPassword:'weak',confirmPassword:'weak'})).status,400);
   assert.equal((await reset(admin.cookie,{accountId:'sam',temporaryPassword:temporary,confirmPassword:'mismatch'})).status,400);
   const result=await reset(admin.cookie,{accountId:'sam',temporaryPassword:temporary,confirmPassword:temporary});assert.equal(result.status,200);assert.equal(result.body.temporaryPassword,undefined);
   assert.equal((await call('/api/auth/me',{cookie:changed.cookie})).status,401);assert.equal((await login('Joe',updated)).status,401);
   joe=await login('Joe',temporary);assert.equal(joe.body.user.mustChangePassword,true);
   assert.equal((await call('/api/auth/me',{cookie:joe.cookie})).body.user.mustChangePassword,true);
   for(const [route,method] of [['/api/workspace','GET'],['/api/workspace/command','POST'],['/api/invoice/scan','POST'],['/api/admin/reset-password','POST'],['/api/files/00000000-0000-4000-8000-000000000000','GET']])assert.equal((await call(route,{cookie:joe.cookie,method,...(method==='POST'?{data:{}}:{})})).status,403);
   const fixed=await change(joe.cookie,{currentPassword:temporary,newPassword:updated,confirmPassword:updated});assert.equal(fixed.status,200);assert.equal(fixed.body.user.mustChangePassword,false);
   assert.equal((await call('/api/auth/me',{cookie:joe.cookie})).status,401);
   const generated=await reset(admin.cookie,{accountId:'jamie'});assert.equal(generated.status,200);assert.equal(passwordError(generated.body.temporaryPassword,generated.body.temporaryPassword),'');
   assert.equal((await call('/api/auth/me',{cookie:lewis.cookie})).status,401);lewis=await login('Lewis',generated.body.temporaryPassword);assert.equal(lewis.body.user.mustChangePassword,true);
   assert.equal((await call('/api/auth/logout',{cookie:lewis.cookie,method:'POST',data:{}})).status,200);
   assert.equal((await call('/api/auth/me',{cookie:admin.cookie})).status,200);
   if(kind==='local'){
    const stored=await fs.readFile(path.join(f.dir,'accounts.json'),'utf8');for(const secret of [original,updated,temporary,generated.body.temporaryPassword])assert.ok(!stored.includes(secret));
    const reopened=await openAuth(f.dir);assert.equal((await reopened.login('Joe',updated,'test')).user.mustChangePassword,false);assert.equal((await reopened.login('Lewis',generated.body.temporaryPassword,'test')).user.mustChangePassword,true);
   }else{
    const row=await f.db.prepare('SELECT * FROM accounts WHERE id=?').bind('sam').first();assert.equal(row.must_change_password,0);assert.equal(row.credential_version,3);assert.notEqual(row.password_hash,updated);
    assert.equal((await f.db.prepare('SELECT count(*) AS n FROM sessions WHERE account_id=? AND credential_version<>?').bind('sam',3).first()).n,0);
   }
  }finally{await f.close();}
 });
 test(`${kind}: password operations are rate limited per account across sessions`,async()=>{
  const f=await fixture(kind);try{const actor=await f.login('Kate');for(let i=0;i<10;i++)assert.equal((await f.call('/api/admin/reset-password',{method:'POST',cookie:actor.cookie,data:{accountId:'missing'}})).status,404);const again=await f.login('Kate');assert.equal((await f.call('/api/auth/change-password',{method:'POST',cookie:again.cookie,data:{}})).status,429);}finally{await f.close();}
 });
}

test('local: concurrent changes cannot reuse the old session; Customer cannot change employee passwords',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bow-auth-race-'));try{
  await provisionAccounts(dir,original);const auth=await openAuth(dir),session=await auth.login('Joe',original,'local'),req={headers:{cookie:session.cookie.split(';')[0]}};
  const results=await Promise.allSettled([updated,temporary].map(password=>auth.changePassword(req,{currentPassword:original,newPassword:password,confirmPassword:password})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,401);
  const customer=auth.createSession({id:'customer-test',role:'Customer',name:'Customer'}),customerReq={headers:{cookie:customer.cookie.split(';')[0]}};
  await assert.rejects(auth.changePassword(customerReq,{}),{status:403});await assert.rejects(auth.resetPassword(customerReq,{accountId:'sam'}),{status:403});
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('cloud: a concurrent reset invalidates a pending change and old-password login',async()=>{
 const f=await fixture('cloud');try{
  const joe=await f.login('Joe'),admin=await f.login('Kate'),batch=f.db.batch.bind(f.db);let reset;
  f.db.batch=async statements=>{f.db.batch=batch;reset=await f.call('/api/admin/reset-password',{cookie:admin.cookie,method:'POST',data:{accountId:'sam',temporaryPassword:temporary,confirmPassword:temporary}});return batch(statements);};
  const response=await f.call('/api/auth/change-password',{cookie:joe.cookie,method:'POST',data:{currentPassword:original,newPassword:updated,confirmPassword:updated}});
  assert.equal(reset.status,200);assert.equal(response.status,409);assert.equal((await f.login('Joe',updated)).status,401);assert.equal((await f.login('Joe',temporary)).body.user.mustChangePassword,true);
  // Simulate reset between password verification and session insertion. The
  // conditional INSERT must not issue a session for the now obsolete password.
  const prepare=f.db.prepare.bind(f.db);let intercepted=false;
  f.db.prepare=sql=>{const stmt=prepare(sql);if(sql.startsWith('INSERT INTO sessions')){const bind=stmt.bind.bind(stmt);stmt.bind=(...args)=>{const bound=bind(...args),run=bound.run.bind(bound);bound.run=async()=>{intercepted=true;await prepare('UPDATE accounts SET credential_version=credential_version+1 WHERE id=?').bind('sam').run();return run();};return bound;};}return stmt;};
  assert.equal((await f.login('Joe',temporary)).status,401);assert.equal(intercepted,true);
 }finally{await f.close();}
});
test('cloud: Customer and inactive accounts cannot use employee password management',async()=>{
 const f=await fixture('cloud');try{
  const {hash}=await import('../cloud/auth.mjs');const raw='customer-session';
  await f.db.prepare("INSERT INTO accounts(id,username,normalized_name,role,salt,password_hash) VALUES('customer-test','Customer','customer','Customer','salt','hash')").run();
  await f.db.prepare('INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)').bind(await hash(raw),'customer-test',Date.now()+60000).run();
  for(const route of ['/api/auth/change-password','/api/admin/reset-password'])assert.equal((await f.call(route,{method:'POST',cookie:'approval_session='+raw,data:{accountId:'sam'}})).status,403);
  const joe=await f.login('Joe'),admin=await f.login('Kate');await f.db.prepare('UPDATE accounts SET active=0 WHERE id=?').bind('sam').run();
  assert.equal((await f.call('/api/auth/change-password',{method:'POST',cookie:joe.cookie,data:{}})).status,401);
  assert.equal((await f.call('/api/admin/reset-password',{method:'POST',cookie:admin.cookie,data:{accountId:'sam'}})).status,404);
 }finally{await f.close();}
});
