import {scryptSync,timingSafeEqual,randomBytes} from 'node:crypto';
import {users} from '../app/domain.mjs';
import {fail} from './http.mjs';
export const normalize=value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
export async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function token(request){return request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('approval_session='))?.slice(17);}
export function cookie(request,value,age){return `approval_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
export async function authenticated(request,env){
 const raw=token(request);if(!raw)fail(401,'Please sign in to continue.');
 const row=await env.DB.prepare('SELECT a.id,a.username,a.role,a.must_change_password FROM sessions s JOIN accounts a ON s.account_id=a.id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1').bind(await hash(raw),Date.now()).first();
 const record=row?.role==='Customer'?await env.DB.prepare("SELECT payload FROM entities WHERE collection='customer' AND id=?").bind(row.id).first():null;
 const c=record?JSON.parse(record.payload):null;
 const user=row?.role==='Customer'?(c?{id:c.id,name:c.contact||c.name,email:c.email,role:'Customer'}:null):users.find(u=>u.id===row?.id&&!u.inactive);if(!user||c&&!c.active)fail(401,'Please sign in to continue.');return {...user,mustChangePassword:!!row.must_change_password};
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
 const customer=account.role==='Customer'?await env.DB.prepare("SELECT payload FROM entities WHERE collection='customer' AND id=?").bind(account.id).first():null;
 const c=customer?JSON.parse(customer.payload):null;
 const user=account.role==='Customer'?(c?.active?{id:c.id,name:c.contact||c.name,email:c.email,role:'Customer'}:null):users.find(u=>u.id===account.id&&!u.inactive);if(!user||(input.audience==='customer')!==(account.role==='Customer'))fail(401,'Incorrect name or password.');
 if(account.role!=='Customer'&&input.password.length<8){await env.DB.prepare('UPDATE accounts SET must_change_password=1 WHERE id=?').bind(account.id).run();account.must_change_password=1;}
 const raw=Array.from(crypto.getRandomValues(new Uint8Array(32)),v=>v.toString(16).padStart(2,'0')).join('');
 await env.DB.prepare('INSERT INTO sessions(token_hash,account_id,expires_at) VALUES(?,?,?)').bind(await hash(raw),user.id,Date.now()+43200000).run();
 return {user:{...user,mustChangePassword:!!account.must_change_password},cookie:cookie(request,raw,43200)};
}
export async function logout(request,env){const raw=token(request);if(raw)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(raw)).run();return cookie(request,'',0);}

export async function validateCustomerPassword(env,c,input){
 const username=String(input.username||c.email).trim(),password=input.password;
 if(!/^[a-zA-Z0-9@._+ -]{3,100}$/.test(username)||typeof password!=='string'||password.length<6||password.length>200)fail(400,'Use a username of 3–100 characters and a password of at least 6 characters.');
 const existing=await env.DB.prepare('SELECT id FROM accounts WHERE normalized_name=?').bind(normalize(username)).first();
 if(existing&&existing.id!==c.id)fail(409,'This username is already in use.');
 return {username,password};
}
export async function setCustomerPassword(env,c,input){
 const {username,password}=await validateCustomerPassword(env,c,input);
 const salt=randomBytes(16).toString('hex'),derived=scryptSync(password,salt,64).toString('hex');
 try{await env.DB.batch([
  env.DB.prepare("INSERT INTO accounts(id,username,normalized_name,role,salt,password_hash,active) VALUES(?,?,?,'Customer',?,?,1) ON CONFLICT(id) DO UPDATE SET username=excluded.username,normalized_name=excluded.normalized_name,salt=excluded.salt,password_hash=excluded.password_hash,active=1").bind(c.id,username,normalize(username),salt,derived),
  env.DB.prepare('DELETE FROM sessions WHERE account_id=?').bind(c.id)
 ]);}catch(e){if(String(e.message).includes('UNIQUE'))fail(409,'This username is already in use.');throw e;}
 return {username,version:await hash(salt)};
}
