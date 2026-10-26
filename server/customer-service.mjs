import {customers,customerView} from '../app/customer-domain.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export const mailConfigured=env=>!!(env.RESEND_API_KEY&&env.EMAIL_FROM&&env.PUBLIC_APP_URL);
export function mailOrigin(env){const u=new URL(env.PUBLIC_APP_URL||'http://127.0.0.1:4185');if(u.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(u.hostname))fail(503,'Configure the public HTTPS application URL.');return u.origin;}
export async function sendCustomerMail(mail,env,fetcher=fetch){
 if(!mailConfigured(env))return {status:'queued',error:'Email delivery is not configured.'};
 try{const response=await fetcher('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+env.RESEND_API_KEY,'Content-Type':'application/json','Idempotency-Key':mail.id},body:JSON.stringify({from:env.EMAIL_FROM,to:[mail.to],subject:mail.subject,text:mail.text}),signal:AbortSignal.timeout(15000)});if(!response.ok)return {status:'failed',error:'Email provider rejected the message (HTTP '+response.status+').'};const result=await response.json();if(!result.id)throw Error();return {status:'accepted',providerId:result.id,sentAt:new Date().toISOString(),error:''};}catch{return {status:'failed',error:'Delivery could not be confirmed. Retry with the same message ID.'};}
}
export async function reconcileCustomerMail(backend,env){
 const {state}=await backend.read();
 for(const r of state.business.requests){const v=r.customerReview;if(r.stage!=='Customer confirmation'||v?.status!=='Pending')continue;const c=customers(state).find(c=>c.id===v.customerId&&c.active),p=state.business.projects.find(p=>p.id===r.projectId&&p.customerId===c?.id);if(!c||!p)continue;
 await backend.enqueue({id:v.id,kind:'confirmation',customerId:c.id,requestId:r.id,reviewId:v.id,to:c.email,subject:'Confirmation requested: '+r.title,text:`Hello ${c.contact||c.name},\n\n${p.name} has a service request for your review: ${v.snapshot.title}.\n\nPlease sign in to review the scope and estimated budget, then confirm, request changes or decline. Internal approval will only continue after your confirmation.\n\n${mailOrigin(env)}/#customer\n\nOpening this email does not approve the request.`,createdAt:Date.now(),status:'queued'});
 }
}
export async function flushCustomerMail(backend,env,send=sendCustomerMail){
 if(!mailConfigured(env)&&send===sendCustomerMail)return;
 for(const candidate of await backend.pending()){
  const m=await backend.claim(candidate.id);if(!m)continue;
  const {state}=await backend.read(),c=customers(state).find(c=>c.id===m.customerId&&c.active);
  const r=state.business.requests.find(r=>r.id===m.requestId);
  if(!c||(m.kind==='confirmation'&&(r?.stage!=='Customer confirmation'||r.customerReview?.id!==m.reviewId))||(m.expiresAt&&m.expiresAt<=Date.now())){await backend.finish(m,{status:'cancelled',error:'This notification is no longer current.'});continue;}
  await backend.finish(m,await send(m,env));
 }
}
export async function issueCustomerLink(backend,env,email,{invite=false}={}){
 const {state}=await backend.read(),c=customers(state).find(c=>c.email===String(email||'').trim().toLowerCase()&&c.active);
 if(!c)return {ok:true};
 const ttl=invite?72*3600000:15*60000,{token,expiresAt}=await backend.issue(c,ttl),url=mailOrigin(env)+'/#access='+token;
 await backend.enqueue({id:'mail-'+crypto.randomUUID(),kind:'access',customerId:c.id,to:c.email,subject:invite?'Your project portal invitation':'Your project portal sign-in link',text:`Hello ${c.contact||c.name},\n\n${invite?'Your customer account is ready. View your projects, confirm proposed services and access completed work.':'Use the secure link below to sign in to your project portal.'}\n\n${url}\n\nThis link is single-use and expires ${invite?'in 72 hours':'in 15 minutes'}. Do not forward it. No project decision is made by signing in.`,createdAt:Date.now(),expiresAt,status:'queued'});
 return {ok:true};
}
export function portalRead(record,actor){try{return {...customerView(record.state,actor),revision:record.revision};}catch{fail(403,'Customer access is unavailable.');}}
export async function portalDecision(backend,actor,input){
 if(input.operation&&input.operation!=='customer-decision')fail(403,'This action is not available.');
 try{await backend.command(actor,{revision:input.revision,operation:'customer-decision',id:input.id,reviewId:input.reviewId,decision:input.decision,comment:input.comment});return portalRead(await backend.read(),actor);}catch(e){if(!e.status)e.status=400;throw e;}
}
