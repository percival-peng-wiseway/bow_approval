import {readWorkspace,command} from './workspace.mjs';
import {hash} from './auth.mjs';
import {fail} from './http.mjs';
const random=()=>[...crypto.getRandomValues(new Uint8Array(32))].map(v=>v.toString(16).padStart(2,'0')).join('');
export function cloudCustomerBackend(env){return {
 read:()=>readWorkspace(env,'alex'),command:(actor,input)=>command(env,actor,input),
 async issue(c,ttl){const token=random(),expiresAt=Date.now()+ttl;await env.DB.prepare('INSERT INTO customer_links(token_hash,customer_id,email,expires_at) VALUES(?,?,?,?)').bind(await hash(token),c.id,c.email,expiresAt).run();return {token,expiresAt};},
 async redeem(token){if(!/^[a-f0-9]{64}$/.test(token||''))fail(400,'Invalid or expired sign-in link.');const tokenHash=await hash(token),l=await env.DB.prepare('SELECT * FROM customer_links WHERE token_hash=? AND used_at IS NULL AND expires_at>?').bind(tokenHash,Date.now()).first();const {state}=await readWorkspace(env,'alex'),c=state.business.customers?.find(c=>c.id===l?.customer_id&&c.email===l.email&&c.active);if(!c)fail(400,'Invalid or expired sign-in link.');const raw=random();
 const result=await env.DB.batch([
 env.DB.prepare('INSERT OR IGNORE INTO accounts(id,username,normalized_name,role,salt,password_hash) VALUES(?,?,?,?,?,?)').bind(c.id,c.email,c.email,'Customer',random(),random()+random()),
 env.DB.prepare('INSERT INTO sessions(token_hash,account_id,expires_at) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM customer_links WHERE token_hash=? AND used_at IS NULL AND expires_at>?)').bind(await hash(raw),c.id,Date.now()+43200000,tokenHash,Date.now()),
 env.DB.prepare('UPDATE customer_links SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>?').bind(Date.now(),tokenHash,Date.now())]);
 if(!result[1].meta.changes)fail(400,'Invalid or expired sign-in link.');return {user:{id:c.id,name:c.contact||c.name,email:c.email,role:'Customer'},token:raw};},
 async enqueue(m){await env.DB.prepare('INSERT OR IGNORE INTO customer_mail(id,payload,status) VALUES(?,?,?)').bind(m.id,JSON.stringify(m),m.status).run();},
 async pending(){return (await env.DB.prepare("SELECT payload FROM customer_mail WHERE status='queued' OR (status='sending' AND lease_until<?) LIMIT 10").bind(Date.now()).all()).results.map(r=>JSON.parse(r.payload));},
 async claim(id){const lease=crypto.randomUUID(),now=Date.now();
 await env.DB.prepare("UPDATE customer_mail SET status='failed',payload=json_set(payload,'$.status','failed','$.error','Retry window expired. Check provider delivery before issuing another notification.') WHERE id=? AND (status='queued' OR (status='sending' AND lease_until<?)) AND first_attempt<=?").bind(id,now,now-23*3600000).run();
 const r=await env.DB.prepare("UPDATE customer_mail SET status='sending',lease=?,lease_until=?,first_attempt=COALESCE(first_attempt,?) WHERE id=? AND (status='queued' OR (status='sending' AND lease_until<?)) AND (first_attempt IS NULL OR first_attempt>?) RETURNING payload").bind(lease,now+60000,now,id,now,now-23*3600000).first();return r?{...JSON.parse(r.payload),lease}:null;},
 async finish(m,result){await env.DB.prepare('UPDATE customer_mail SET payload=?,status=? WHERE id=? AND lease=?').bind(JSON.stringify({...m,...result}),result.status,m.id,m.lease).run();},
 async list(){return (await env.DB.prepare('SELECT payload,status FROM customer_mail ORDER BY rowid DESC LIMIT 100').all()).results.map(r=>{const {text,lease,...m}=JSON.parse(r.payload);return {...m,status:r.status};});},
 async retry(id){const r=await env.DB.prepare("UPDATE customer_mail SET status='queued' WHERE id=? AND status='failed' AND first_attempt>?").bind(id,Date.now()-23*3600000).run();if(!r.meta.changes)fail(400,'This message cannot be retried safely. Check its provider status.');}
};}
