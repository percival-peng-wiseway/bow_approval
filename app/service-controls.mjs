import {directorGate,allGateVotes,lastProjectPayment,projectDirector} from './director-policy.mjs';
import {invoiceFlow,invoiceAssignees,invoiceActions,handleInvoiceAction,prepareInvoicePayment,approvedInvoices} from './invoice-controls.mjs';
import {users} from './domain.mjs';
const clean=v=>String(v??'').trim(),copy=v=>structuredClone(v),need=(v,m)=>{if(!v)throw new Error(m);};
const uid=p=>`${p}-${crypto.randomUUID()}`,now=()=>new Date().toISOString();
const money=v=>Math.round(Number(v)*100),date=v=>/^\d{4}-\d{2}-\d{2}$/.test(v||'')&&!Number.isNaN(Date.parse(v+'T12:00:00Z'))&&new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v;
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Melbourne',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const costCodes=['Planning & permits','Professional services','Design & engineering','Site works','Construction','Marketing & sales','Project administration','Other'];
export const paymentKinds=['Deposit / advance','Progress','Final','Retention'];
export const isServiceV2=r=>r.kind==='service'&&r.serviceFlowVersion===2;
export const serviceTotal=r=>Math.round(((r.serviceContract?.amount||0)+(r.variations||[]).filter(v=>v.status==='Executed').reduce((s,v)=>s+v.delta,0))*100)/100;
export const paidTotal=r=>(r.payments||[]).filter(p=>p.status==='Paid').reduce((s,p)=>s+money(p.amount),0)/100;
const reviewer=(r,id)=>id&&id!==r.requester?[id]:users.filter(u=>u.role==='Director'&&!u.inactive&&u.id!==r.requester).map(u=>u.id);
const finance=r=>r.requester==='jamie'?'alex':'jamie';
export const variationReviewers=r=>directorGate(r,{finance:finance(r),director:reviewer(r,projectDirector(r))[0]},r.pendingVariation?.revisedTotal??serviceTotal(r));
const current=r=>r.payments.find(p=>p.status!=='Paid');
export function serviceAssignees(r){
 if(!isServiceV2(r))return null;const invoice=invoiceAssignees(r);if(invoice)return invoice;
 if(['Payment setup','Payment review','Ready to pay'].includes(r.stage))return [finance(r)];
 if(['Contract signing','Variation signing','Completion evidence'].includes(r.stage))return [r.requester];
 if(['PM delivery review','Completion review'].includes(r.stage))return reviewer(r,r.route.pm);
 if(r.stage==='Completion sign-off')return reviewer(r,r.route.director);
 if(r.stage==='Variation review')return Object.entries(variationReviewers(r)).filter(([k])=>!r.pendingVariation?.votes?.[k]).map(([,id])=>id);
 return null;
}
export function serviceActions(r,actor){
 if(!isServiceV2(r))return [];
 const actions=invoiceActions(r,actor),assigned=(serviceAssignees(r)||[]).includes(actor);
 if(assigned){const action={'Contract signing':'sign-contract','Variation signing':'sign-variation','Completion evidence':'complete-service'}[r.stage];if(action)actions.push(action);else if(['Variation review','PM delivery review','Completion review','Completion sign-off'].includes(r.stage))actions.push('approve','return');}
 if(r.stage==='Payment setup'&&actor===finance(r))actions.push('verify-bank');
 if(r.serviceContract?.execution&&['Payment setup','Payment documents'].includes(r.stage)&&[r.requester,r.route?.pm].includes(actor))actions.push('variation');
 return actions;
}
export function projectFinancials(project,requests){
 const list=requests.filter(r=>r.projectId===project.id),signed=list.filter(r=>r.kind==='service'&&r.serviceContract?.execution),variations=signed.reduce((s,r)=>s+(r.variations||[]).filter(v=>v.status==='Executed').reduce((n,v)=>n+money(v.delta),0),0)/100;
 const original=signed.reduce((s,r)=>s+money(r.serviceContract.amount),0)/100,committed=signed.reduce((s,r)=>s+money(r.stage==='Cancelled'?paidTotal(r):serviceTotal(r)),0)/100+list.filter(r=>r.kind==='reimbursement'&&!['Draft','Returned','Withdrawn','Cancelled'].includes(r.stage)).reduce((s,r)=>s+money(r.amount),0)/100;
 const paid=list.reduce((s,r)=>s+money(paidTotal(r)),0)/100,budget=project.budget==null?null:Number(project.budget);
 return {budget,original,variations,committed,paid,remainingCommitments:Math.max(0,Math.round((committed-paid)*100)/100),available:budget==null?null:Math.round((budget-committed)*100)/100};
}
function execution(data,filesValid){
 filesValid(data.files,true);need(clean(data.signatory)&&clean(data.signatory).length<=160,'Enter the authorised signatory.');need(date(data.signedDate)&&data.signedDate<=today(),'Enter the actual signing date.');need(data.authorityConfirmed===true,'Confirm the document is signed by authorised parties.');
 return {files:copy(data.files),signatory:clean(data.signatory),signedDate:data.signedDate,recordedAt:now()};
}
export function handleServiceAction(state,r,actor,action,data,{filesValid,log}){
 if(!isServiceV2(r))return false;if(handleInvoiceAction(state,r,actor,action,data,{filesValid,log}))return true;
 if(action==='sign-contract'){
  need(r.serviceContract?.approvedBy,'Finance must review the contract first.');need(clean(r.payingEntity),'Set the paying legal entity before signing.');
  const signed=execution(data,filesValid);if(data.defectsUntil)need(date(data.defectsUntil)&&data.defectsUntil>=signed.signedDate,'Enter a valid defects period end date.');
  r.serviceContract.execution={...signed,recordedBy:actor,payingEntity:r.payingEntity,defectsUntil:data.defectsUntil||''};r.stage=invoiceFlow(r)?'Invoice preparation':'Payment setup';log(r,actor,'Contract executed',`${r.payingEntity} · ${signed.signatory} · ${signed.signedDate}`);return true;
 }
 if(action==='verify-bank'){
  if(invoiceFlow(r))need(clean(data.bankDetails)===r.serviceContract.bankDetails,'Payment details must match the reviewed invoice.');const bank=clean(data.bankDetails),contact=clean(data.contact),method=clean(data.method);need(bank&&bank.length<=3000,'Enter the verified bank or payment destination.');need(contact&&contact.length<=500,'Record the independently sourced contact used to verify the payment destination.');need(['Trusted phone call','In person','Verified supplier portal'].includes(method),'Choose an independent verification method.');need(data.confirmed===true,'Confirm independent verification was completed.');
  r.serviceContract.bankVerificationHistory??=[];if(r.serviceContract.bankVerification)r.serviceContract.bankVerificationHistory.push(copy(r.serviceContract.bankVerification));r.serviceContract.bankDetails=bank;r.serviceContract.bankVerification={bankDetails:bank,contact,method,by:actor,at:now()};if(invoiceFlow(r)){const supplier=state.business.suppliers?.find(s=>s.invoiceDetails?.invoiceId===r.serviceContract.invoicePaymentSource);if(supplier)supplier.paymentVerification=copy(r.serviceContract.bankVerification);}log(r,actor,'Payment destination verified',`${method} · ${contact}`);return true;
 }
 if(action==='variation'){
  need(!r.pendingVariation,'Resolve the current variation first.');const delta=Number(data.delta);need(clean(data.title)&&clean(data.reason),'Describe the variation and its reason.');need(clean(data.title).length<=160&&clean(data.reason).length<=3000&&clean(data.timeImpact).length<=1000,'Variation text is too long.');need(data.delta!==''&&data.delta!=null&&Number.isFinite(delta)&&Math.abs(delta)<=1e9,'Enter a valid increase or reduction.');filesValid(data.files,true);
  const revised=(money(serviceTotal(r))+money(delta))/100;need(revised>0&&revised>=paidTotal(r),'Revised contract value cannot be below payments already recorded.');
  // Customer approval of a variation is recorded against its separate document,
  // never by overwriting the original service confirmation or request scope.
  const customerRequired=!!r.customerReview;
  if(customerRequired){need(data.customerConfirmed===true,'Record customer consent for this variation first.');filesValid(data.customerFiles,true);need(clean(data.customerReference),'Record the customer consent reference.');}
  r.pendingVariation={id:uid('variation'),title:clean(data.title),reason:clean(data.reason),timeImpact:clean(data.timeImpact),delta:money(delta)/100,baseTotal:serviceTotal(r),revisedTotal:revised,files:copy(data.files),customerConsent:customerRequired?{files:copy(data.customerFiles),reference:clean(data.customerReference),recordedBy:actor,at:now()}:null,requestedBy:actor,at:now(),votes:{},resumeStage:r.stage,status:'In review'};r.stage='Variation review';log(r,actor,'Variation submitted',`${r.pendingVariation.title} · AUD ${r.pendingVariation.delta} · revised total AUD ${revised}`);return true;
 }
 if(r.stage==='Variation review'&&action==='approve'){
  const v=r.pendingVariation,key=Object.entries(variationReviewers(r)).find(([k,id])=>id===actor&&!v.votes[k])?.[0];need(key,'This variation vote is not available.');v.votes[key]={by:actor,at:now()};log(r,actor,'Variation approved',v.title);if(allGateVotes(variationReviewers(r),v.votes)){v.status='Approved';r.stage='Variation signing';}return true;
 }
 if(r.stage==='Variation review'&&action==='return'){
  need(clean(data.reason),'Explain why the variation is returned.');const v=r.pendingVariation;v.status='Returned';v.returnReason=clean(data.reason);r.variations??=[];r.variations.push(copy(v));r.stage=v.resumeStage;r.pendingVariation=null;log(r,actor,'Variation returned',clean(data.reason));return true;
 }
 if(action==='sign-variation'){
  const v=r.pendingVariation;need(v&&allGateVotes(variationReviewers(r),v.votes),'Both variation approvals are required.');need(serviceTotal(r)===v.baseTotal,'The contract changed. Submit a new variation.');v.execution={...execution(data,filesValid),recordedBy:actor};v.status='Executed';r.variations??=[];r.variations.push(copy(v));r.pendingVariation=null;r.completionAccepted=null;r.completionEvidence=null;r.paymentPlanHistory??=[];r.paymentPlanHistory.push({at:now(),payments:copy(r.payments)});r.payments=r.payments.filter(p=>p.status==='Paid');r.stage='Payment setup';log(r,actor,'Variation executed',`${v.title} · AUD ${v.delta} · revised total AUD ${serviceTotal(r)}. Replan the remaining balance.`);return true;
 }
 if(action==='plan'){
  const c=r.serviceContract;if(invoiceFlow(r))need(approvedInvoices(r).length,'Approve an invoice before payment setup.');need(c?.execution&&c?.approvedBy,'Record the executed contract before payment setup.');need(c.bankVerification?.bankDetails===c.bankDetails&&!!c.bankDetails,'Independently verify the payment destination before payment setup.');
  const balance=money(serviceTotal(r))-money(paidTotal(r));need(Array.isArray(data.payments)&&(balance===0?data.payments.length===0:data.payments.length>0),'Add payment milestones for the remaining balance.');
  const payments=data.payments.map(p=>{need(clean(p.label)&&clean(p.requirements),'Describe the milestone and required evidence.');need(paymentKinds.includes(p.kind),'Choose Deposit / advance, Progress, Final or Retention.');need(date(p.dueDate),'Enter an expected payment date.');need(['Bank transfer','Card','BPAY','Other'].includes(p.method),'Select a payment method.');need(p.amount!==''&&Number.isFinite(Number(p.amount))&&money(p.amount)>0&&Number(p.amount)<=1e9,'Enter a positive payment amount.');if(p.kind==='Retention'&&c.execution.defectsUntil)need(p.dueDate>=c.execution.defectsUntil,'Retention release cannot precede the recorded defects period end.');return {id:uid('payment'),label:clean(p.label),kind:p.kind,amount:money(p.amount)/100,dueDate:p.dueDate,method:p.method,requirements:clean(p.requirements),status:'Pending',files:[],submissions:[]};});
  need(payments.reduce((s,p)=>s+money(p.amount),0)===balance,'Payment amounts must equal the remaining contract balance.');need(payments.every((p,i)=>!i||p.dueDate>=payments[i-1].dueDate),'Payment dates must be in chronological order.');
  need(payments.every((p,i)=>p.kind!=='Final'||payments.slice(i+1).every(n=>n.kind==='Retention')),'Only retention may follow the final payment.');
  r.payments=[...r.payments.filter(p=>p.status==='Paid'),...payments];r.stage=payments.length?'Payment documents':r.completionAccepted?'Completed':'Completion evidence';log(r,actor,'Payment plan approved',payments.map(p=>`${p.kind} · ${p.label} · AUD ${p.amount}`).join('\n')||'No outstanding payment balance.');return true;
 }
 if(action==='documents'){
  const p=current(r);prepareInvoicePayment(r,p,data);if(invoiceFlow(r)){filesValid(data.extraFiles||[]);data.files=[...data.files,...(data.extraFiles||[])];}filesValid(data.files,true);need(clean(data.note),'Describe the delivery or the contractual basis for the advance.');need(clean(data.invoiceNumber)&&clean(data.invoiceNumber).length<=160,'Enter the supplier invoice or claim reference (up to 160 characters).');need(clean(data.note).length<=3000,'Delivery notes are too long.');need(date(data.receivedDate)&&data.receivedDate<=today(),'Enter the actual receipt date.');need(date(data.invoiceDueDate),'Enter the contractual payment due date.');if(data.responseDueDate)need(date(data.responseDueDate)&&data.responseDueDate>=data.receivedDate,'Enter a valid payment-claim response deadline.');
  const supplier=r.quotes.find(q=>q.id===r.selectedQuote)?.supplier?.toLowerCase(),abn=clean(r.serviceContract?.abn).replace(/\D/g,'');const sameSupplier=other=>abn&&clean(other.serviceContract?.abn).replace(/\D/g,'')?abn===clean(other.serviceContract.abn).replace(/\D/g,''):other.quotes?.find(q=>q.id===other.selectedQuote)?.supplier?.toLowerCase()===supplier;need(!state.business.requests.some(other=>other.kind==='service'&&sameSupplier(other)&&other.payments.some(payment=>payment.id!==p.id&&(!invoiceFlow(r)||other.id!==r.id||payment.invoiceId!==data.invoiceId)&&payment.invoiceNumber?.toLowerCase()===clean(data.invoiceNumber).toLowerCase()&&payment.status!=='Cancelled')),'This supplier invoice reference is already recorded.');
  const final=['Final','Retention'].includes(p.kind);if(final){filesValid(data.acceptanceFiles||[],true);need(clean(data.acceptanceSummary),'Describe the completion or defects / retention release evidence.');}
  Object.assign(p,{...(invoiceFlow(r)?{invoiceId:data.invoiceId}:{}),files:copy(data.files),invoiceNumber:clean(data.invoiceNumber),receivedDate:data.receivedDate,invoiceDueDate:data.invoiceDueDate,responseDueDate:data.responseDueDate||'',deliverySummary:clean(data.note),projectDirectorApproval:null,pmReview:null,status:'Review',acceptance:final?{files:copy(data.acceptanceFiles),summary:clean(data.acceptanceSummary),submittedBy:actor,approvedBy:null}:null});p.submissions.push({at:now(),actor,files:copy(p.files),note:p.deliverySummary,invoiceNumber:p.invoiceNumber,acceptance:copy(p.acceptance)});r.stage='PM delivery review';log(r,actor,'Payment evidence submitted',`${p.kind} · ${p.invoiceNumber} · PM verification required`);return true;
 }
 if(r.stage==='PM delivery review'&&action==='approve'){
  const p=current(r);need(clean(data.note),'Record the PM verification of delivery or the advance payment basis.');p.pmReview={by:actor,at:now(),note:clean(data.note)};r.stage=['Final','Retention'].includes(p.kind)?'Final acceptance':lastProjectPayment(r,p)?'Project Director sign-off':'Payment review';log(r,actor,'Delivery verified',`${p.label} · ${clean(data.note)}`);return true;
 }
 if(r.stage==='PM delivery review'&&action==='return'){
  need(clean(data.reason),'Explain what needs to change.');const p=current(r);p.projectDirectorApproval=null;p.pmReview=null;p.status='Pending';if(p.acceptance)p.acceptance.approvedBy=null;r.stage='Payment documents';log(r,actor,'Payment evidence returned',clean(data.reason));return true;
 }
 if(action==='complete-service'){
  filesValid(data.files,true);need(clean(data.summary),'Describe the completed work and any defects resolved.');r.completionEvidence={files:copy(data.files),summary:clean(data.summary),by:actor,at:now()};r.stage='Completion review';log(r,actor,'Completion evidence submitted',clean(data.summary));return true;
 }
 if(['Completion review','Completion sign-off'].includes(r.stage)&&action==='approve'){
  if(r.stage==='Completion review'){r.completionEvidence.pm={by:actor,at:now()};r.stage='Completion sign-off';}else{r.completionAccepted={by:actor,at:now()};r.stage='Completed';}log(r,actor,'Completion verified','Service completion recorded separately from advance payment.');return true;
 }
 if(['Completion review','Completion sign-off'].includes(r.stage)&&action==='return'){
  need(clean(data.reason),'Explain what needs to change.');r.stage='Completion evidence';r.completionAccepted=null;log(r,actor,'Completion returned',clean(data.reason));return true;
 }
 return false;
}
