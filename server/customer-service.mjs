import {notificationItems} from '../app/workspace-insights.mjs';
import {users} from '../app/domain.mjs';
import {isAdmin} from '../app/domain.mjs';
import {applyCommand} from './commands.mjs';
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
 for(const r of state.business.requests){const v=r.customerReview;if(r.notifyCustomer===false||r.stage!=='Customer confirmation'||v?.status!=='Pending')continue;const c=customers(state).find(c=>c.id===v.customerId&&c.active),p=state.business.projects.find(p=>p.id===r.projectId&&p.customerId===c?.id);if(!c||!p)continue;
 await backend.enqueue({id:v.id,kind:'confirmation',customerId:c.id,requestId:r.id,reviewId:v.id,to:c.email,subject:'Confirmation requested: '+r.title,text:`Hello ${c.contact||c.name},\n\n${p.name} has a service request for your review: ${v.snapshot.title}.\n\nPlease sign in to review the scope and estimated budget, then confirm, request changes or decline. Internal approval will only continue after your confirmation.\n\n${mailOrigin(env)}/#customer\n\nOpening this email does not approve the request.`,createdAt:Date.now(),status:'queued'});
 }
}
const localToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Melbourne',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export async function reconcileStaffMail(backend,env){
 const {state}=await backend.read();
 for(const [actor,settings] of Object.entries(state.business?.notificationSettings||{})){
  if(!settings.enabled||!settings.email||!users.some(u=>u.id===actor&&!u.inactive))continue;
  for(const item of notificationItems(state,actor,localToday())){
   if(settings[item.kind]===false)continue;
   const id=`staff:${actor}:${item.id}`;
   await backend.enqueue({id,kind:'staff',staffId:actor,eventId:item.id,category:item.kind,requestId:item.requestId,to:settings.email,subject:'BOW OA · '+(item.kind==='acknowledgement'?'Expense acknowledgement requested':item.kind==='payment'?'Payment reminder':item.kind==='returned'?'Changes requested':'Action required'),text:`${item.title}\n\n${item.detail}\n\nOpen Home in BOW OA to review this request:\n${mailOrigin(env)}/\n\nNo approval or payment is made by opening this email.`,createdAt:Date.now(),status:'queued'});
  }
 }
}
export async function flushCustomerMail(backend,env,send=sendCustomerMail){
 if(!mailConfigured(env)&&send===sendCustomerMail)return;
 for(const candidate of await backend.pending()){
  const m=await backend.claim(candidate.id);if(!m)continue;
  const {state}=await backend.read();
  if(m.kind==='staff'){
   const settings=state.business?.notificationSettings?.[m.staffId];
   const current=settings?.enabled&&settings.email===m.to&&settings[m.category]!==false&&users.some(u=>u.id===m.staffId&&!u.inactive)&&notificationItems(state,m.staffId,localToday()).some(i=>i.id===m.eventId);
   await backend.finish(m,current?await send(m,env):{status:'cancelled',error:'This notification is no longer current.'});continue;
  }
  const c=customers(state).find(c=>c.id===m.customerId&&c.active);
  const r=state.business.requests.find(r=>r.id===m.requestId);
  if(!c||(m.kind==='confirmation'&&(r?.notifyCustomer===false||r?.stage!=='Customer confirmation'||r.customerReview?.id!==m.reviewId))||(m.expiresAt&&m.expiresAt<=Date.now())){await backend.finish(m,{status:'cancelled',error:'This notification is no longer current.'});continue;}
  if(m.kind==='credentials'){
   const p=state.business.projects.find(p=>p.id===m.projectId&&p.active&&p.customerId===m.customerId);
   if(!p||c.email!==m.to||await backend.passwordVersion(m.customerId)!==m.passwordVersion){await backend.finish(m,{status:'cancelled',error:'The project access or password changed. Create a new invitation.'});continue;}
   try{const password=await backend.unseal(m.credentials);await backend.finish(m,await send({...m,text:m.text+'\nPassword: '+password+'\n\nKeep these credentials private. Contact the project team if you need help signing in.'},env));}
   catch{await backend.finish(m,{status:'failed',error:'Invitation could not be prepared. Check the mail encryption key and retry.'});}
  }else await backend.finish(m,await send(m,env));
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
export function adminCustomerPreview(record,actor,customerId){
 if(!isAdmin(actor))fail(403,'Only Admin can preview customer portals.');
 const view=portalRead(record,customerId);
 for(const project of view.projects)for(const request of project.requests)request.canConfirm=false;
 return {...view,readOnly:true};
}
export async function portalDecision(backend,actor,input){
 if(input.operation&&input.operation!=='customer-decision')fail(403,'This action is not available.');
 try{await backend.command(actor,{revision:input.revision,operation:'customer-decision',id:input.id,reviewId:input.reviewId,decision:input.decision,comment:input.comment});return portalRead(await backend.read(),actor);}catch(e){if(!e.status)e.status=400;throw e;}
}

export async function inviteProjectCustomer(backend,credentials,actor,input,env){
 if(!isAdmin(actor))fail(403,'Only Admin can invite project customers.');
 if(!/^[a-f0-9-]{36}$/.test(input.invitationId||''))fail(400,'Open a new invitation form.');
 const id='invitation-'+input.invitationId,prior=await backend.mail(id);
 if(prior){if(prior.projectId!==input.projectId)fail(409,'Invitation belongs to another project.');return {id,status:prior.status,username:prior.username,customerId:prior.customerId};}
 const record=await backend.read();if(input.revision!==record.revision)fail(409,'The workspace changed. Review the latest project and try again.');
 const command={operation:'project-customer',projectId:input.projectId,data:{name:input.name,contact:input.contact,email:input.email}};
 const preview=applyCommand(structuredClone(record.state),actor,command);
 await credentials.validate(preview.customer,input);
 const encrypted=await backend.seal(input.password);
 const result=await backend.command(actor,{...command,revision:input.revision});
 const {customer,project}=result.result;
 let login;
 try{
  login=await credentials.set(customer,input);
  await backend.enqueue({id,kind:'credentials',projectId:project.id,customerId:customer.id,username:login.username,passwordVersion:login.version,credentials:encrypted,to:customer.email,subject:'Your BOW OA invitation — '+project.name,text:`Hello ${customer.contact||customer.name},\n\nYou have been invited to ${project.name} in BOW OA.\n\nView project progress, review shared engineering contracts and respond when a customer confirmation is requested.\n\nOpen ${mailOrigin(env)}/#customer and select Customer version.\n\nUsername: ${login.username}`,createdAt:Date.now(),expiresAt:Date.now()+7*86400000,status:'queued'});
 }catch{fail(503,'The customer is linked, but the invitation was not queued. Review the login settings and retry.');}
 return {id,customerId:customer.id,username:login.username,status:'queued'};
}
