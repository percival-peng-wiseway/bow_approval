import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {createWorkspaceServer} from '../server.mjs';
import {provisionAccounts} from '../server/auth.mjs';
test('notification API scopes preferences, activity and retries to signed-in staff',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bow-notifications-'));let server;
 try{await provisionAccounts(dir,'test-only-password');server=await createWorkspaceServer({dataDir:dir,mailEnv:{},sendMail:async()=>({status:'failed',error:'Test provider failure'})});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const call=async(route,cookie,data)=>{const res=await fetch(base+route,{method:data?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json',Origin:base,'X-Requested-With':'ApprovalWorkspace'}:{})},body:data?JSON.stringify(data):undefined});return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};};
 const login=async username=>(await call('/api/auth/login',null,{username,password:'test-only-password'})).cookie;
 assert.equal((await call('/api/notifications')).status,401);const kate=await login('Kate'),lewis=await login('Lewis'),joe=await login('Joe');
 const cmd=async(cookie,input)=>{const prior=await call('/api/workspace',cookie);const v=await call('/api/workspace/command',cookie,{revision:prior.body.revision,...input});assert.equal(v.status,200,JSON.stringify(v.body));return v.body;};
 await cmd(lewis,{operation:'notification-settings',actor:'alex',data:{email:'finance@example.invalid',enabled:true}});
 await cmd(joe,{operation:'request',submit:true,data:{kind:'corporation',amount:10,invoiceDate:'2026-11-01',attachments:[{name:'receipt.txt',data:'data:text/plain;base64,YQ==',size:1}]}});
 // Admin's existing mail endpoint drains the local queue using the injected test sender only.
 await call('/api/customer/admin',kate);const own=await call('/api/notifications',lewis);assert.equal(own.body.configured,false);assert.equal(own.body.mail.length,1);assert.equal(own.body.mail[0].status,'failed');assert.equal((await call('/api/notifications',kate)).body.mail.length,0);
 const id=own.body.mail[0].id;assert.equal((await call('/api/notifications/retry',kate,{id})).status,403);assert.equal((await call('/api/notifications/retry',lewis,{id})).status,200);
 const state=(await call('/api/workspace',lewis)).body.state;assert.equal(state.business.notificationSettings.jamie.email,'finance@example.invalid');assert.equal(state.business.notificationSettings.alex,undefined);
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
});
