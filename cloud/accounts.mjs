import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {publicDirectory,accountMetadata,validateStaffChange,strongPassword,normalizeName} from '../server/accounts.mjs';
import {fail} from './http.mjs';
export const allAccounts=async env=>(await env.DB.prepare('SELECT * FROM accounts').all()).results;
export const staffDirectory=async env=>publicDirectory(await allAccounts(env));
export const staffAccounts=async env=>accountMetadata(await allAccounts(env));
export async function saveStaff(env,actor,input,state){
 const accounts=await allAccounts(env),next=validateStaffChange(accounts,actor,input,state),old=accounts.find(a=>a.id===next.id);
 const salt=input.password?randomBytes(16).toString('hex'):old?.salt,derived=input.password?scryptSync(input.password,salt,64).toString('hex'):old?.password_hash;
 const change=input.password?1:old?.must_change_password||0,updated=input.password?Date.now():old?.password_updated_at||null;
 try{await env.DB.batch([
  env.DB.prepare('INSERT INTO accounts(id,username,normalized_name,display_name,role,active,salt,password_hash,must_change_password,password_updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,normalized_name=excluded.normalized_name,display_name=excluded.display_name,role=excluded.role,active=excluded.active,salt=excluded.salt,password_hash=excluded.password_hash,must_change_password=excluded.must_change_password,password_updated_at=excluded.password_updated_at').bind(next.id,next.username,normalizeName(next.username),next.displayName,next.role,next.active?1:0,salt,derived,change,updated),
  env.DB.prepare('DELETE FROM sessions WHERE account_id=?').bind(next.id),
  env.DB.prepare('INSERT INTO account_events(id,actor,account_id,action,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),actor,next.id,!old?'Created':input.password?'Password reset':'Updated',Date.now())
 ]);}catch(e){if(String(e.message).includes('UNIQUE'))fail(409,'This username is already in use.');throw e;}
 return {accounts:await staffAccounts(env),directory:await staffDirectory(env)};
}
export async function changePassword(env,id,currentPassword,password){
 strongPassword(password);const old=await env.DB.prepare('SELECT * FROM accounts WHERE id=? AND active=1').bind(id).first();
 if(!old||(!old.must_change_password&&!timingSafeEqual(scryptSync(String(currentPassword||''),old.salt,64),Buffer.from(old.password_hash,'hex'))))fail(400,'Current password is incorrect.');
 if(timingSafeEqual(scryptSync(password,old.salt,64),Buffer.from(old.password_hash,'hex')))fail(400,'Choose a different password.');
 const salt=randomBytes(16).toString('hex'),derived=scryptSync(password,salt,64).toString('hex');
 const result=await env.DB.batch([
  env.DB.prepare('UPDATE accounts SET salt=?,password_hash=?,must_change_password=0,password_updated_at=? WHERE id=? AND password_hash=?').bind(salt,derived,Date.now(),id,old.password_hash),
  env.DB.prepare('DELETE FROM sessions WHERE account_id=?').bind(id),
  env.DB.prepare('INSERT INTO account_events(id,actor,account_id,action,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),id,id,'Password changed',Date.now())
 ]);if(!result[0].meta.changes)fail(409,'Account changed. Sign in and try again.');return {ok:true};
}
