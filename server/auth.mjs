import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash} from 'node:crypto';
import {promisify} from 'node:util';
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
 const accounts=JSON.parse(await fs.readFile(path.join(dir,'accounts.json'),'utf8'));
 const sessions=new Map(),attempts=new Map();
 const publicUser=id=>users.find(u=>u.id===id);
 return {
  createSession(user){const token=randomBytes(32).toString('hex');sessions.set(digest(token),{id:user.id,user,expires:Date.now()+43200000});return {user,cookie:`approval_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`};},
  user(req){const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('approval_session='))?.slice(17);if(!token)return null;const key=digest(token),session=sessions.get(key);if(!session||session.expires<Date.now()){sessions.delete(key);return null;}return session.user||publicUser(session.id);},
  async login(username,password,address){
   const key=address+':'+normalize(username),now=Date.now();
   for(const [key,v] of attempts)if(v.until<now)attempts.delete(key);
   const failures=attempts.get(key)||{count:0,until:now+15*60*1000};
   const globalKey=address+':*',globalFailures=attempts.get(globalKey)||{count:0,until:now+15*60*1000};
   if(failures.count>=8||globalFailures.count>=40)throw Object.assign(new Error('Too many attempts. Try again in 15 minutes.'),{status:429});
   const account=accounts.find(a=>normalize(a.username)===normalize(username));
   const hash=await scrypt(String(password||''),account?.salt||'unknown-account',64);
   if(!account||!timingSafeEqual(hash,Buffer.from(account.hash,'hex'))){failures.count++;globalFailures.count++;attempts.set(key,failures);attempts.set(globalKey,globalFailures);throw Object.assign(new Error('Incorrect name or password.'),{status:401});}
   attempts.delete(key);const token=randomBytes(32).toString('hex');
   for(const [key,s] of sessions)if(s.expires<now)sessions.delete(key);
   sessions.set(digest(token),{id:account.id,expires:now+12*60*60*1000});
   return {user:publicUser(account.id),cookie:`approval_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`};
  },
  logout(req){const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('approval_session='))?.slice(17);if(token)sessions.delete(digest(token));return 'approval_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';}
 };
}
