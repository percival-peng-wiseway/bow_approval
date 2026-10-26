import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
const digest=s=>createHash('sha256').update(s).digest('hex');
export async function localCustomerBackend(dir,workspace){
 const file=path.join(dir,'customer-access.json');let record;try{record=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;record={links:[],outbox:[]};}
 let queue=Promise.resolve();const change=fn=>{const p=queue.then(async()=>{const next=structuredClone(record),result=await fn(next);await fs.writeFile(file+'.tmp',JSON.stringify(next),{mode:0o600});await fs.rename(file+'.tmp',file);record=next;return result;});queue=p.catch(()=>{});return p;};
 return {read:()=>workspace.read('alex'),command:(actor,input)=>workspace.command(actor,input),
  issue:(c,ttl)=>change(r=>{const token=randomBytes(32).toString('hex'),expiresAt=Date.now()+ttl;r.links=r.links.filter(x=>x.expiresAt>Date.now());r.links.push({hash:digest(token),customerId:c.id,email:c.email,expiresAt});return {token,expiresAt};}),
  redeem:token=>change(r=>{if(!/^[a-f0-9]{64}$/.test(token||''))throw Object.assign(new Error('Invalid or expired sign-in link.'),{status:400});const l=r.links.find(l=>l.hash===digest(token)&&!l.used&&l.expiresAt>Date.now()),c=workspace.read('alex').state.business.customers?.find(c=>c.id===l?.customerId&&c.email===l.email&&c.active);if(!l||!c)throw Object.assign(new Error('Invalid or expired sign-in link.'),{status:400});l.used=true;return {id:c.id,name:c.contact||c.name,email:c.email,role:'Customer'};}),
  enqueue:m=>change(r=>{if(!r.outbox.some(v=>v.id===m.id))r.outbox.push(m);}),
  pending:async()=>record.outbox.filter(m=>m.status==='queued'||m.status==='sending'&&m.leaseUntil<Date.now()).slice(0,10),
  claim:id=>change(r=>{const m=r.outbox.find(m=>m.id===id&&(m.status==='queued'||m.status==='sending'&&m.leaseUntil<Date.now()));if(!m)return null;m.status='sending';m.lease=crypto.randomUUID();m.leaseUntil=Date.now()+60000;m.firstAttempt??=Date.now();if(Date.now()-m.firstAttempt>23*3600000){m.status='failed';m.error='Retry window expired. Check provider delivery before issuing another notification.';return null;}return structuredClone(m);}),
  finish:(m,result)=>change(r=>{const old=r.outbox.find(v=>v.id===m.id&&v.lease===m.lease);if(old)Object.assign(old,result);}),
  list:async()=>record.outbox.map(({text,lease,...m})=>m).reverse().slice(0,100),
  retry:id=>change(r=>{const m=r.outbox.find(m=>m.id===id&&m.status==='failed');if(!m||Date.now()-(m.firstAttempt||Date.now())>23*3600000)throw Object.assign(new Error('This message cannot be retried safely. Check its provider status.'),{status:400});m.status='queued';})
 };
}
