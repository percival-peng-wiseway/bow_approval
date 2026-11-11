import {directorPaymentPending} from './director-policy.mjs';
import {isServiceV2,serviceTotal} from './service-controls.mjs';
import {users} from './domain.mjs';
import {allowedActions,pendingDirectorNotice,assignees,currentPayment,isFinalPayment} from './business.mjs';
import {paymentDueDate,needsAction,upcomingPayments} from './workspace-model.mjs';
export const returnedRequest=r=>r.stage==='Returned'||r.stage==='Customer changes'||r.stage==='Contract preparation'&&!!r.serviceContract?.returnReason;
const closed=r=>['Completed','Cancelled'].includes(r.stage);
export function homeGroups(state,actor){
 const requests=state.business?.requests||[];
 const relevant=r=>r.requester===actor||r.route?.pm===actor||r.route?.director===actor||r.history?.some(e=>e.actor===actor)||assignees(r).includes(actor);
 return {action:requests.filter(r=>needsAction(r,actor)&&!returnedRequest(r)),returned:requests.filter(r=>returnedRequest(r)&&needsAction(r,actor)),waiting:requests.filter(r=>relevant(r)&&!closed(r)&&!needsAction(r,actor)),completed:requests.filter(r=>relevant(r)&&closed(r))};
}
export function nextTask(r,actor){
 if(isServiceV2(r)){const task={'Invoice preparation':'Upload invoice and check supplier ABN','Invoice review':'Review invoice ABN and supplier payment details','Contract signing':'Record signed contract','Variation review':'Review contract variation','Variation signing':'Record signed variation','PM delivery review':'Verify delivery or advance payment basis','Completion evidence':'Upload service completion evidence','Completion review':'Verify service completion','Completion sign-off':'Confirm final completion'}[r.stage];if(task)return task;}
 if(actor&&pendingDirectorNotice(r)&&r.directorNotice.recipient===actor)return 'Acknowledge expense · no approval required';
 const action=assignees(r).flatMap(id=>allowedActions(r,id)).find(a=>['approve','contract','source','documents','plan','paid','submit','lodge'].includes(a));
 return ({lodge:'Publish completed work to the customer',approve:directorPaymentPending(r)?'Approve last project payment':r.stage==='Final acceptance'?'Review final acceptance':r.stage==='Contract review'?'Review contract and payment terms':'Review and approve',contract:'Upload contract and submit to Finance',source:'Describe proposals and select a supplier',documents:isFinalPayment(r)?'Upload invoice and final acceptance evidence':'Upload payment documents',plan:'Set payment milestones',paid:'Record completed payment',submit:returnedRequest(r)?'Update and resubmit':'Submit request'})[action]||(r.stage==='Customer confirmation'?'Confirm scope and estimated budget':closed(r)?'No pending action':'Review request');
}
export function paymentReadiness(r,p){
 const final=isFinalPayment(r,p),paid=p.status==='Paid',cancelled=p.status==='Cancelled';
 const items=[...(isServiceV2(r)?[{label:'Executed contract',done:!!r.serviceContract?.execution},{label:'Payment destination verified',done:!!r.serviceContract?.bankVerification&&r.serviceContract.bankVerification.bankDetails===r.serviceContract.bankDetails},{label:'PM verification',done:!!p.pmReview}]:[]),{label:'Supporting documents',done:!!p.files?.length}];
 if(final){items.push({label:'Acceptance evidence',done:!!p.acceptance?.files?.length&&!!p.acceptance.summary},{label:'Director acceptance',done:!!p.acceptance?.approvedBy});}
 items.push({label:'Finance approval',done:['Ready','Paid'].includes(p.status)},{label:'Payment recorded',done:paid});
 const status=cancelled?'Cancelled':paid?'Paid':p.status==='Ready'&&(!isServiceV2(r)||p.pmReview)&&(!final||p.acceptance?.approvedBy)?'Ready to pay':p.status==='Review'?(isServiceV2(r)&&!p.pmReview?'PM verification':final&&!p.acceptance?.approvedBy?'Awaiting Director':'Finance review'):'Documents required';
 return {status,final,items,current:currentPayment(r)?.id===p.id};
}
const fileKey=f=>f.data;
export function requestDocumentRows(r){
 const rows=[],current=new Set(),shared=new Set((r.customerContracts?.files||[]).concat(r.customerCompletion?.files||[]).map(fileKey));
 const add=(files,category,version='Current',historical=false)=>{for(const f of files||[]){if(!f?.data)continue;const key=fileKey(f);if(!historical)current.add(key);rows.push({file:f,category,version,historical,shared:shared.has(key)});}};
 for(const i of r.invoices||[])add(i.files,'Supplier invoice',i.invoiceNumber+' · '+i.status,i.status==='Returned');
 add(r.attachments,'Receipts & evidence');for(const q of r.quotes||[]){add(q.quoteFiles,'Quotes',q.id===r.selectedQuote?'Selected quote':'Alternative quote');if(!r.serviceContract||q.id!==r.selectedQuote)add(q.contractFiles,'Contracts',q.id===r.selectedQuote?'Selected supplier':'Alternative supplier');}
 add(r.serviceContract?.execution?.files,'Executed contract');for(const v of r.variations||[]){add(v.files,'Variation',v.title);add(v.execution?.files,'Executed variation',v.title);add(v.customerConsent?.files,'Variation customer consent',v.title);}add(r.pendingVariation?.files,'Variation in review');add(r.completionEvidence?.files,'Completion evidence');
 add(r.serviceContract?.files,'Contracts',`Version ${r.serviceContract?.revision||1} · ${r.serviceContract?.approvedBy?'Finance approved':r.serviceContract?.submittedAt?'In review':'Draft'}`);
 for(const p of r.payments||[]){add(p.files,'Invoices & payment documents',p.label);add(p.acceptance?.files,'Acceptance',p.label);add(p.proof,'Payment receipts',p.label);for(const s of p.submissions||[]){add(s.files,'Invoices & payment documents','Earlier submission',true);add(s.acceptance?.files,'Acceptance','Earlier submission',true);}}
 add(r.customerCompletion?.files,'Completion','Published');
 for(const c of r.contractHistory||[])add(c.files,'Contracts',`Version ${c.revision||1}`,true);
 for(const a of r.archives||[]){add(a.attachments,'Receipts & evidence',`Request revision ${a.revision}`,true);for(const q of a.quotes||[]){add(q.quoteFiles,'Quotes','Earlier selection',true);add(q.contractFiles,'Contracts','Earlier selection',true);}add(a.serviceContract?.files,'Contracts','Earlier request',true);for(const p of a.payments||[]){add(p.files,'Invoices & payment documents','Earlier request',true);add(p.acceptance?.files,'Acceptance','Earlier request',true);add(p.proof,'Payment receipts','Earlier request',true);}}
 const seen=new Set();return rows.filter(row=>{const key=row.file.data;if(row.historical&&current.has(key)||seen.has(key))return false;seen.add(key);return true;});
}
const fileNames=files=>(files||[]).map(f=>f.name).join(', ');
const fileSignature=f=>{let h=2166136261;for(const c of f.data||''){h=Math.imul(h^c.charCodeAt(0),16777619);}return `${f.name}:${f.size||0}:${h>>>0}`;};
export function reviewSnapshot(r){const q=r.quotes?.find(q=>q.id===r.selectedQuote),p=currentPayment(r);return {title:r.title,background:[r.background,r.purpose].filter(Boolean).join('\n'),delivery:r.approach,amount:r.amount,expenseDate:r.invoiceDate||'',attachments:fileNames(r.attachments),attachmentFiles:(r.attachments||[]).map(fileSignature),supplier:q?.supplier||'',supplierAmount:q?.amount??null,supplierPriceMin:q?.priceMin??null,supplierScope:q?.serviceScope||'',quotes:fileNames((r.quotes||[]).flatMap(q=>q.quoteFiles||[])),quoteFiles:(r.quotes||[]).flatMap(q=>(q.quoteFiles||[]).map(fileSignature)),selection:r.selectionReason||'',contractAmount:r.serviceContract?.amount??null,contractFiles:(r.serviceContract?.files||[]).map(fileSignature),contractNames:fileNames(r.serviceContract?.files),paymentTerms:r.serviceContract?.paymentTerms||'',contractNotes:r.serviceContract?.notes||'',bankDetails:r.serviceContract?.bankDetails||'',abn:r.serviceContract?.abn||'',paymentFiles:(p?.files||[]).map(fileSignature),paymentNames:fileNames(p?.files),acceptanceFiles:(p?.acceptance?.files||[]).map(fileSignature),acceptance:p?.acceptance?.summary||''};}
export function changedFields(before,after){if(!before)return [];const fields=[['title','Service'],['background','Background'],['delivery','Delivery format'],['amount','Requested budget'],['expenseDate','Expense date'],['attachmentFiles','Receipts / evidence','attachments'],['supplier','Selected supplier'],['supplierAmount','Selected quote / upper limit'],['supplierPriceMin','Supplier minimum price'],['supplierScope','Supplier service content'],['quoteFiles','Quotation files','quotes'],['selection','Selection reason'],['contractAmount','Contract amount'],['contractFiles','Contract files','contractNames'],['paymentTerms','Payment terms'],['contractNotes','Notes for Finance'],['bankDetails','Bank details'],['abn','Supplier ABN'],['paymentFiles','Payment documents','paymentNames'],['acceptanceFiles','Acceptance files'],['acceptance','Acceptance summary']];return fields.filter(([key])=>JSON.stringify(before[key]??'')!==JSON.stringify(after[key]??'')).map(([key,label,display])=>({label,before:display?before[display]:Array.isArray(before[key])?'Previous files':before[key],after:display?after[display]:Array.isArray(after[key])?'Updated files':after[key]}));}
export function notificationItems(state,actor,today){
 const groups=homeGroups(state,actor),events=[...groups.returned,...groups.action].filter(r=>!(pendingDirectorNotice(r)&&r.directorNotice.recipient===actor)).map(r=>({id:`action:${r.id}:${r.stage}:${r.history?.at(-1)?.id||r.revision}`,kind:returnedRequest(r)?'returned':'action',requestId:r.id,title:r.title,detail:nextTask(r,actor)}));
 for(const r of state.business.requests)if(pendingDirectorNotice(r)&&r.directorNotice.recipient===actor)events.push({id:`acknowledgement:${r.directorNotice.id}`,kind:'acknowledgement',requestId:r.id,title:r.title,detail:`Project reimbursement · AUD ${r.directorNotice.amount.toFixed(2)}. Please acknowledge that you have seen this expense. This is not an approval; Finance and payment can proceed.`});
 for(const {request:r,payment:p} of upcomingPayments(state.business.requests,actor,state.business.projects,today))events.push({id:`payment:${r.id}:${p.id}:${paymentDueDate(p)}`,kind:'payment',requestId:r.id,title:r.title,detail:`${p.label} · ${paymentDueDate(p)<today?'Overdue':'Due'} ${paymentDueDate(p)}`});
 return events;
}
export function saveNotificationSettings(state,actor,input){
 if(!users.some(u=>u.id===actor&&!u.inactive))throw new Error('Staff account required.');
 const d=input.data||{},email=String(d.email||'').trim().toLowerCase();if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Enter a valid notification email.');if(email.length>100)throw new Error('Email is too long.');
 const value={email,enabled:d.enabled===true,action:d.action!==false,returned:d.returned!==false,payment:d.payment!==false,acknowledgement:d.acknowledgement!==false};if(value.enabled&&!email)throw new Error('Add an email address before enabling email notifications.');
 state.business.notificationSettings??={};state.business.notificationSettings[actor]=value;return value;
}
