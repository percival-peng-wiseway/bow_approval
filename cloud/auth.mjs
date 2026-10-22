import {scryptSync,timingSafeEqual} from 'node:crypto';
import {users} from '../app/domain.mjs';
import {fail} from './http.mjs';
export const normalize=value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
export async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function token(request){return request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('approval_session='))?.slice(17);}
export function cookie(request,value,age){return `approval_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
export async function authenticated(request,env){
 const raw=token(request);if(!raw)fail(401,'Please sign in to continue.');
 const row=await env.DB.prepare('SELECT a.id FROM sessions s JOIN accounts a ON s.account_id=a.id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1').bind(await hash(raw),Date.now()).first();
 const user=users.find(u=>u.id===row?.id&&!u.inactive);if(!user)fail(401,'Please sign in to continue.');return user;
}
export async function rateLimit(env,key,maximum,windowMs){
 const now=Date.now();const row=await env.DB.prepare(`INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END, expires_at=CASE WHEN expires_at<=? THEN ? ELSE expires_at END RETURNING count`).bind(key,now+windowMs,now,now,now+windowMs).first();
 if(row.count>maximum)fail(429,'Too many attempts. Please try again later.');
}
export async function login(request,env,input){
 if(typeof input.username!=='string'||typeof input.password!=='string'||input.username.length>100||input.password.length>200)fail(400,'Enter your name and password.');
 const username=normalize(input.username),address=request.headers.get('CF-Connecting-IP')||'local';
 await rateLimit(env,'login-ip:'+await hash(address),40,15*60*1000);
 await rateLimit(env,'login-user:'+await hash(address+':'+username),10,15*60*1000);
 const account=await env.DB.prepare('SELECT * FROM accounts WHERE normalized_name=? AND active=1').bind(username).first();
 const derived=scryptSync(input.password,account?.salt||'unknown-account',64);
 if(!account||!timingSafeEqual(derived,Buffer.from(account.password_hash,'hex')))fail(401,'Incorrect name or password.');
 const user=users.find(u=>u.id===account.id&&!u.inactive);if(!user)fail(401,'Incorrect name or password.');
 const raw=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
 await env.DB.prepare('INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)').bind(await hash(raw),user.id,Date.now()+43200000).run();
 return {user,cookie:cookie(request,raw,43200)};
}
export async function logout(request,env){const raw=token(request);if(raw)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(raw)).run();return cookie(request,'',0);}
