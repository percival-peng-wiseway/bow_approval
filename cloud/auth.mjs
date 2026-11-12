import {passwordError} from '../app/password-policy.mjs';
import {scryptSync,timingSafeEqual,randomBytes} from 'node:crypto';
import {users} from '../app/domain.mjs';
import {fail} from './http.mjs';
export const normalize=value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
export async function hash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
function token(request){return request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith('approval_session='))?.slice(17);}
export function cookie(request,value,age){return `approval_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${age}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
export async function authenticated(request,env){
 const raw=token(request);if(!raw)fail(401,'Please sign in to continue.');
 const row=await env.DB.prepare('SELECT a.id,a.username,a.role,a.must_change_password FROM sessions s JOIN accounts a ON s.account_id=a.id WHERE s.token_hash=? AND s.expires_at>? AND a.active=1 AND s.credential_version=a.credential_version').bind(await hash(raw),Date.now()).first();
 const user=row?.role==='Customer'?{id:row.id,name:row.username,email:row.username,role:'Customer'}:users.find(u=>u.id===row?.id&&!u.inactive);if(!user)fail(401,'Please sign in to continue.');return {...user,mustChangePassword:Boolean(row.must_change_password)};
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
 const inserted=await env.DB.prepare('INSERT INTO sessions(token_hash,account_id,expires_at,credential_version) SELECT ?,id,?,credential_version FROM accounts WHERE id=? AND active=1 AND password_hash=? AND credential_version=?').bind(await hash(raw),Date.now()+43200000,user.id,account.password_hash,account.credential_version).run();
 if(!inserted.meta.changes)fail(401,'Password changed. Please sign in again.');
 return {user:{...user,mustChangePassword:Boolean(account.must_change_password)},cookie:cookie(request,raw,43200)};
}
export async function logout(request,env){const raw=token(request);if(raw)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(raw)).run();return cookie(request,'',0);}

const verify=(password,account)=>timingSafeEqual(scryptSync(password,account.salt,64),Buffer.from(account.password_hash,'hex'));
export async function changePassword(request,env,input){
 const actor=await authenticated(request,env);if(actor.role==='Customer')fail(403,'Employee accounts only.');
 if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'Invalid request.');
 await rateLimit(env,'password:'+actor.id,10,900000);
 if(typeof input.currentPassword!=='string'||input.currentPassword.length>200)fail(400,'Enter your current password.');
 const error=passwordError(input.newPassword,input.confirmPassword);if(error)fail(400,error);
 const account=await env.DB.prepare('SELECT * FROM accounts WHERE id=? AND active=1').bind(actor.id).first();
 if(!account||!verify(input.currentPassword,account))fail(400,'Current password is incorrect.');
 if(input.currentPassword===input.newPassword)fail(400,'Choose a different new password.');
 const salt=randomBytes(16).toString('hex'),passwordHash=scryptSync(input.newPassword,salt,64).toString('hex');
 const raw=randomBytes(32).toString('hex'),version=account.credential_version+1;
 // CAS plus session check prevents an in-flight change from undoing an Admin reset.
 // D1 batch is atomic: credential update, revocation, and replacement session commit together.
 const results=await env.DB.batch([
  env.DB.prepare(`UPDATE accounts SET salt=?,password_hash=?,must_change_password=0,credential_version=credential_version+1 WHERE id=? AND active=1 AND credential_version=? AND EXISTS(SELECT 1 FROM sessions WHERE token_hash=? AND account_id=accounts.id AND credential_version=accounts.credential_version AND expires_at>?)`).bind(salt,passwordHash,actor.id,account.credential_version,await hash(token(request)),Date.now()),
  env.DB.prepare('DELETE FROM sessions WHERE account_id=? AND credential_version<>(SELECT credential_version FROM accounts WHERE id=?)').bind(actor.id,actor.id),
  env.DB.prepare('INSERT INTO sessions(token_hash,account_id,expires_at,credential_version) SELECT ?,id,?,credential_version FROM accounts WHERE id=? AND active=1 AND password_hash=? AND credential_version=?').bind(await hash(raw),Date.now()+43200000,actor.id,passwordHash,version)
 ]);
 if(!results[0].meta.changes)fail(409,'Password or session changed. Please sign in again.');
 return {user:{...actor,mustChangePassword:false},cookie:cookie(request,raw,43200)};
}
export async function resetPassword(request,env,input){
 const actor=await authenticated(request,env);
 if(actor.role!=='Admin'||actor.mustChangePassword)fail(403,'Only Admin can reset employee passwords.');
 if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'Invalid request.');
 await rateLimit(env,'password:'+actor.id,10,900000);
 if(input.accountId===actor.id)fail(400,'Use Change password for your own account.');
 const target=users.find(u=>u.id===input.accountId&&!u.inactive&&u.role!=='Customer');
 if(!target)fail(404,'Employee account not found.');
 const account=await env.DB.prepare("SELECT * FROM accounts WHERE id=? AND active=1 AND role<>'Customer'").bind(target.id).first();
 if(!account)fail(404,'Employee account not found.');
 const generated=input.temporaryPassword===undefined||input.temporaryPassword==='';
 if(generated&&input.confirmPassword)fail(400,'Enter and confirm the temporary password, or leave both blank.');
 const password=generated?'Aa1!'+randomBytes(18).toString('base64url'):input.temporaryPassword;
 const error=passwordError(password,generated?password:input.confirmPassword);if(error)fail(400,error);
 if(verify(password,account))fail(400,'Choose a different temporary password.');
 const salt=randomBytes(16).toString('hex'),passwordHash=scryptSync(password,salt,64).toString('hex');
 const results=await env.DB.batch([
  env.DB.prepare(`UPDATE accounts SET salt=?,password_hash=?,must_change_password=1,credential_version=credential_version+1 WHERE id=? AND active=1 AND credential_version=? AND EXISTS(SELECT 1 FROM sessions s JOIN accounts a ON s.account_id=a.id WHERE s.token_hash=? AND a.id=? AND a.active=1 AND a.role='Admin' AND a.must_change_password=0 AND s.credential_version=a.credential_version AND s.expires_at>?)`).bind(salt,passwordHash,target.id,account.credential_version,await hash(token(request)),actor.id,Date.now()),
  env.DB.prepare('DELETE FROM sessions WHERE account_id=? AND credential_version<>(SELECT credential_version FROM accounts WHERE id=?)').bind(target.id,target.id)
 ]);
 if(!results[0].meta.changes)fail(409,'Password or session changed. Please try again.');
 return {ok:true,mustChangePassword:true,...(generated?{temporaryPassword:password}:{})};
}
