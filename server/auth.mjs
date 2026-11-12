import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {passwordError} from '../app/password-policy.mjs';
import {users} from '../app/domain.mjs';
const scrypt=promisify(scryptCallback);
export const accountIds=['sam','director-b','director-c','jamie','alex','taylor','pm-b'];
export async function provisionAccounts(dir,password){
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 const accounts=await Promise.all(accountIds.map(async id=>{const user=users.find(u=>u.id===id);const salt=randomBytes(16).toString('hex');return {id,username:user.name,salt,hash:(await scrypt(password,salt,64)).toString('hex')};}));
 await fs.writeFile(path.join(dir,'accounts.json'),JSON.stringify(accounts,null,2),{flag:'wx',mode:0o600});
}
const normalize=value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
const digest=value=>createHash('sha256').update(value).digest('hex');
export async function openAuth(dir){
 let accounts=JSON.parse(await fs.readFile(path.join(dir,'accounts.json'),'utf8'));
 const sessions=new Map(),attempts=new Map();
 const publicUser=id=>{const user=users.find(u=>u.id===id&&!u.inactive);return user?{...user,mustChangePassword:Boolean(accounts.find(a=>a.id===id)?.mustChangePassword)}:null;};
 const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
 let queue=Promise.resolve();
 const serial=fn=>{const job=queue.then(fn);queue=job.catch(()=>{});return job;};
 const limit=(key,max=10)=>{const now=Date.now();for(const [k,v] of attempts)if(v.until<=now)attempts.delete(k);const v=attempts.get(key)||{count:0,until:now+900000};attempts.set(key,v);if(++v.count>max)fail(429,'Too many attempts. Try again in 15 minutes.');};
 const persist=async next=>{const target=path.join(dir,'accounts.json'),temp=target+'.tmp';await fs.writeFile(temp,JSON.stringify(next,null,2),{mode:0o600});await fs.rename(temp,target);accounts=next;};
 const verify=async(password,account)=>timingSafeEqual(await scrypt(password,account.salt,64),Buffer.from(account.hash,'hex'));
 const api={
  createSession(user){const token=randomBytes(32).toString('hex');sessions.set(digest(token),{id:user.id,user,expires:Date.now()+43200000});return {user,cookie:`approval_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`};},
  user(req){const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('approval_session='))?.slice(17);if(!token)return null;const key=digest(token),session=sessions.get(key);if(!session||session.expires<Date.now()){sessions.delete(key);return null;}return session.user?.role==='Customer'?session.user:publicUser(session.id);},
  login(username,password,address){return serial(async()=>{
   if(typeof username!=='string'||typeof password!=='string'||username.length>100||password.length>200)fail(400,'Enter your name and password.');
   const key=address+':'+normalize(username),now=Date.now();
   for(const [key,v] of attempts)if(v.until<now)attempts.delete(key);
   const failures=attempts.get(key)||{count:0,until:now+15*60*1000};
   const globalKey=address+':*',globalFailures=attempts.get(globalKey)||{count:0,until:now+15*60*1000};
   if(failures.count>=8||globalFailures.count>=40)throw Object.assign(new Error('Too many attempts. Try again in 15 minutes.'),{status:429});
   const account=accounts.find(a=>normalize(a.username)===normalize(username));
   const hash=await scrypt(String(password||''),account?.salt||'unknown-account',64);
   if(!account||!publicUser(account.id)||!timingSafeEqual(hash,Buffer.from(account.hash,'hex'))){failures.count++;globalFailures.count++;attempts.set(key,failures);attempts.set(globalKey,globalFailures);throw Object.assign(new Error('Incorrect name or password.'),{status:401});}
   attempts.delete(key);const token=randomBytes(32).toString('hex');
   for(const [key,s] of sessions)if(s.expires<now)sessions.delete(key);
   sessions.set(digest(token),{id:account.id,expires:now+12*60*60*1000});
   return {user:publicUser(account.id),cookie:`approval_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`};
  });},
  changePassword(req,input){return serial(async()=>{
   const actor=api.user(req);if(!actor)fail(401,'Please sign in to continue.');if(actor.role==='Customer')fail(403,'Employee accounts only.');
   if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'Invalid request.');
   limit('password:'+actor.id);const account=accounts.find(a=>a.id===actor.id);
   if(typeof input.currentPassword!=='string'||input.currentPassword.length>200)fail(400,'Enter your current password.');
   const error=passwordError(input.newPassword,input.confirmPassword);if(error)fail(400,error);
   if(!await verify(input.currentPassword,account))fail(400,'Current password is incorrect.');
   if(input.currentPassword===input.newPassword)fail(400,'Choose a different new password.');
   const salt=randomBytes(16).toString('hex'),hash=(await scrypt(input.newPassword,salt,64)).toString('hex');
   await persist(accounts.map(a=>a.id===actor.id?{...a,salt,hash,mustChangePassword:false}:a));
   for(const [key,s] of sessions)if(s.id===actor.id)sessions.delete(key);
   return api.createSession(publicUser(actor.id));
  });},
  resetPassword(req,input){return serial(async()=>{
   const actor=api.user(req);if(!actor)fail(401,'Please sign in to continue.');
   if(actor.role!=='Admin'||actor.mustChangePassword)fail(403,'Only Admin can reset employee passwords.');
   if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'Invalid request.');
   limit('password:'+actor.id);if(input.accountId===actor.id)fail(400,'Use Change password for your own account.');
   const account=accounts.find(a=>a.id===input.accountId);if(!account||!publicUser(account.id))fail(404,'Employee account not found.');
   const generated=input.temporaryPassword===undefined||input.temporaryPassword==='';
   if(generated&&input.confirmPassword)fail(400,'Enter and confirm the temporary password, or leave both blank.');
   const password=generated?'Aa1!'+randomBytes(18).toString('base64url'):input.temporaryPassword;
   const error=passwordError(password,generated?password:input.confirmPassword);if(error)fail(400,error);
   if(await verify(password,account))fail(400,'Choose a different temporary password.');
   const salt=randomBytes(16).toString('hex'),hash=(await scrypt(password,salt,64)).toString('hex');
   await persist(accounts.map(a=>a.id===account.id?{...a,salt,hash,mustChangePassword:true}:a));
   for(const [key,s] of sessions)if(s.id===account.id)sessions.delete(key);
   return {ok:true,mustChangePassword:true,...(generated?{temporaryPassword:password}:{})};
  });},
  logout(req){const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('approval_session='))?.slice(17);if(token)sessions.delete(digest(token));return 'approval_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';}
 };
 return api;
}
