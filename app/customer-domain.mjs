import {users} from './domain.mjs';
const need=(v,m)=>{if(!v)throw new Error(m);};
const text=v=>String(v||'').trim();
const role=id=>users.find(u=>u.id===id)?.role;
const uid=p=>p+'-'+crypto.randomUUID();
const now=()=>new Date().toISOString();
export function customers(state){state.business??={projects:[],requests:[]};return state.business.customers??=[];}
export function saveCustomer(state,input,actor){
 need(role(actor)==='Admin','Only Admin can manage customer accounts.');
 const list=customers(state),old=list.find(c=>c.id===input.id),email=text(input.email).toLowerCase();
 need(text(input.name)&&text(input.name).length<=160,'Enter the customer / company name.');
 need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&email.length<=100,'Enter a valid customer email.');
 need(!old||email===old.email,'Create a new customer account to change the sign-in email.');
 need(!list.some(c=>c.id!==old?.id&&c.email===email),'This customer email already exists.');
 const c={id:old?.id||uid('customer'),name:text(input.name),contact:text(input.contact).slice(0,160),email,active:input.active!==false,createdAt:old?.createdAt||now()};
 if(old)Object.assign(old,c);else list.push(c);return c;
}
export function projectCustomer(state,project){return customers(state).find(c=>c.id===project?.customerId);}
export function validateProjectCustomer(state,input,old){
 const id=input.customerId===undefined?(old?.customerId||''):text(input.customerId);
 need(!id||customers(state).some(c=>c.id===id&&(c.active||id===old?.customerId)),'Choose an active customer.');
 if(old&&id!==(old.customerId||''))need(!state.business.requests.some(r=>r.projectId===old.id&&r.customerReview),'Customer access has already been established. Create a separate project to change its customer.');
 return id;
}
export function beginCustomerReview(state,r,resumeStage='Budget review'){
 const p=state.business.projects.find(p=>p.id===r.projectId),c=projectCustomer(state,p);if(!p?.customerId)return false;
 need(c?.active,'The project customer is inactive. Ask Admin to reactivate the account.');
 r.customerReviews??=[];if(r.customerReview)r.customerReviews.push(structuredClone(r.customerReview));
 r.customerReview={id:uid('review'),customerId:c.id,customerName:c.name,version:r.customerReviews.length+1,status:'Pending',requestedAt:now(),resumeStage,snapshot:{title:r.title,background:r.background,purpose:r.purpose,approach:r.approach,amount:r.budgetChange||r.amount}};
 r.stage='Customer confirmation';return true;
}
export function customerDecision(state,actor,input){
 const c=customers(state).find(c=>c.id===actor&&c.active);need(c,'Customer access is unavailable.');
 const r=state.business.requests.find(r=>r.id===input.id),p=state.business.projects.find(p=>p.id===r?.projectId),review=r?.customerReview;
 need(p?.customerId===actor&&review?.customerId===actor,'Request not available.');
 need(r.stage==='Customer confirmation'&&review.status==='Pending'&&review.id===input.reviewId,'This confirmation has changed or has already been answered. Refresh the page.');
 need(['approve','changes','decline'].includes(input.decision),'Choose a decision.');
 const comment=text(input.comment);need(comment.length<=3000,'Keep the comment under 3,000 characters.');if(input.decision!=='approve')need(comment.length>=3,'Explain the changes or why this service is not needed.');
 review.status={approve:'Approved',changes:'Changes requested',decline:'Declined'}[input.decision];review.comment=comment;review.decidedAt=now();review.decidedBy=actor;
 r.stage=input.decision==='approve'?review.resumeStage:'Customer changes';
 r.history.push({id:uid('event'),at:now(),actor,action:'Customer '+review.status.toLowerCase(),detail:`Version ${review.version} · AUD ${review.snapshot.amount}${comment?' · '+comment:''}`});return r;
}
export function canLodge(r,actor){return r.kind==='service'&&r.stage==='Completed'&&!!r.customerReview&&(actor===r.requester||['Admin','Finance','Director'].includes(role(actor))||actor===r.route?.pm);}
export function lodgeCompletion(r,actor,data){
 need(canLodge(r,actor),'Only the project team can publish completion after the service is completed.');
 need(text(data.summary)&&text(data.summary).length<=3000,'Add a completion summary (up to 3,000 characters).');
 need(Array.isArray(data.files)&&data.files.length<=20,'Choose the customer-facing completion files.');
 for(const f of data.files)need(text(f.name)&&typeof f.data==='string'&&(/^(data:(application\/pdf|image\/(png|jpeg|webp)|text\/plain);base64,|\/api\/files\/[a-f0-9-]{36}$)/.test(f.data)),'Unsupported completion document.');
 r.customerCompletion={summary:text(data.summary),files:structuredClone(data.files),publishedAt:now(),publishedBy:actor};
 r.history.push({id:uid('event'),at:now(),actor,action:'Completion published to customer',detail:r.customerCompletion.summary});return r;
}
export function customerView(state,actor){
 const c=customers(state).find(c=>c.id===actor&&c.active);need(c,'Customer access is unavailable.');
 const projects=state.business.projects.filter(p=>p.customerId===actor).map(p=>({id:p.id,name:p.name,active:p.active,pm:users.find(u=>u.id===p.pm)?.name||'',requests:state.business.requests.filter(r=>r.projectId===p.id&&r.customerReview?.customerId===actor).map(r=>({id:r.id,reference:r.reference,review:structuredClone(r.customerReview),status:r.stage==='Customer confirmation'?'Awaiting your confirmation':r.stage==='Customer changes'?r.customerReview.status:r.stage==='Completed'?'Completed':r.stage==='Cancelled'?'Cancelled':r.stage==='Withdrawn'?'Withdrawn':'In progress',progress:({'Customer confirmation':'Awaiting your confirmation','Customer changes':'Your feedback is with the project team','Budget review':'Internal pre-approval','Sourcing':'Preparing supplier quotes and contracts','Supplier review':'Reviewing service documents','Payment setup':'Planning service payments','Payment documents':'Service in progress','Final acceptance':'Checking completed work','Payment review':'Finalizing supporting documents','Ready to pay':'Payment processing','Completed':'Completed','Withdrawn':'Paused by the project team','Cancelled':'Cancelled'})[r.stage]||'In progress',completion:r.stage==='Completed'?structuredClone(r.customerCompletion||{summary:'Service completed.',files:[],publishedAt:r.history.filter(e=>e.action==='Payment recorded').at(-1)?.at||''}):null}))}));
 return {customer:{id:c.id,name:c.name,contact:c.contact,email:c.email},projects};
}
export function customerFiles(state,actor){return customerView(state,actor).projects.flatMap(p=>p.requests.flatMap(r=>r.completion?.files||[]));}
