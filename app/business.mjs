import {validateProjectCustomer,beginCustomerReview,canLodge,lodgeCompletion} from './customer-domain.mjs';
import {users} from './domain.mjs';

export const role = id => users.find(u => u.id === id)?.role;
export const isManager = id => ['Admin','Finance','Director'].includes(role(id));
export const kinds = {corporation:'Corporation reimbursement', reimbursement:'Project reimbursement', service:'Service purchase'};
export const stageLabels = ['Budget review','Sourcing','Supplier review','Payment setup','Payment documents','Final acceptance','Payment review','Ready to pay','Completed'];
export const needsSupervisor = actor => role(actor)==='Employee';
export const isFinalPayment = (r,p=currentPayment(r)) => r.kind==='service' && !!p && r.payments.at(-1)===p;
export function gateReviewers(r){return {finance:r.requester==='jamie'?'alex':'jamie',director:reviewer(r,r.route.director)[0]};}
export function gateVotes(r){return r.gates?.[r.stage]||{};}
function afterPM(r){r.stage=r.route.threshold!=null&&r.amount>=r.route.threshold?'Director review':'Finance review';if(r.stage==='Director review')r.reviewReturn='Finance review';}
const copy = x => structuredClone(x);
const uid = prefix => `${prefix}-${globalThis.crypto.randomUUID()}`;
const text = v => String(v || '').trim();
const fail = message => {throw new Error(message);};
const need = (condition,message) => {if(!condition)fail(message);};
const cents = v => {need(v!=='' && v!=null && Number.isFinite(Number(v)) && Number(v)>0 && Number(v)<=1e9,'Enter a positive amount up to AUD 1 billion.');const rounded=Math.round(Number(v)*100);need(rounded>=1,'Amount must be at least AUD 0.01.');return rounded;};
const validDate = v => {if(!/^\d{4}-\d{2}-\d{2}$/.test(v||''))return false;const d=new Date(v+'T12:00:00Z');return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===v;};
const person = (id,r) => role(id) && id !== r.requester;
const directors = r => users.filter(u=>u.role==='Director'&&u.id!==r.requester).map(u=>u.id);
const reviewer = (r,id) => person(id,r)?[id]:directors(r);
export function ensureBusiness(state){state.business??={projects:[],requests:[]};return state.business;}
export const projectFor = (state,r) => ensureBusiness(state).projects.find(p=>p.id===r.projectId);
export const businessAmount = r => r.kind==='service' ? (r.quotes?.find(q=>q.id===r.selectedQuote)?.amount || r.amount) : r.amount;
const archive = r => {r.archives??=[];r.archives.push({at:new Date().toISOString(),revision:r.revision,attachments:copy(r.attachments),quotes:copy(r.quotes),payments:copy(r.payments)});};
const log = (r,actor,action,detail='') => r.history.push({id:uid('event'),at:new Date().toISOString(),actor,action,detail});
function filesValid(files,required=false){need(Array.isArray(files),'Invalid supporting documents.');if(required)need(files.length>0,'Upload receipts or supporting evidence.');for(const f of files)need(text(f.name)&&typeof f.data==='string'&&(/^data:(application\/pdf|image\/(png|jpeg|webp)|text\/plain);base64,/.test(f.data)||(/^\/api\/files\/[a-f0-9-]{36}$/.test(f.data)&&Number.isFinite(f.size)&&f.size>0)),'Upload a PDF, image or text document.');need(files.reduce((n,f)=>n+(f.data.startsWith('/api/files/')?Math.ceil(f.size*4/3):f.data.length),0)<4*1024*1024,'Supporting files must total less than 3 MB.');}
export function saveProject(state,data,actor){need(isManager(actor),'Only Admin, Finance or Directors can manage projects.');const b=ensureBusiness(state),old=b.projects.find(p=>p.id===data.id);need(text(data.name),'Enter a project name.');need(!b.projects.some(p=>p.id!==data.id&&p.name.toLowerCase()===text(data.name).toLowerCase()),'A project with this name already exists.');need(role(data.pm)==='PM','Assign a PM.');need(role(data.director)==='Director','Assign a Director.');const threshold=data.threshold===''||data.threshold==null?null:cents(data.threshold)/100;const p={id:old?.id||uid('project'),name:text(data.name),pm:data.pm,director:data.director,threshold,customerId:validateProjectCustomer(state,data,old),active:data.active!==false,history:[...(old?.history||[]),{at:new Date().toISOString(),actor,name:text(data.name),pm:data.pm,director:data.director,threshold,active:data.active!==false}]};if(old)Object.assign(old,p);else b.projects.push(p);return p;}
function validateRequest(state,data,actor){
  need(role(actor),'Unknown user.');need(Object.hasOwn(kinds,data.kind),'Choose a request category.');
  const amount=cents(data.amount)/100, service=data.kind==='service';
  const invoice={supplier:text(data.supplier),invoiceReference:text(data.invoiceReference),invoiceDate:text(data.invoiceDate)};
  if(invoice.invoiceDate)need(validDate(invoice.invoiceDate),'Enter a valid expense date.');
  let project;if(data.kind!=='corporation'){project=ensureBusiness(state).projects.find(p=>p.id===data.projectId);need(project?.active,'Select an active project.');}
  let supervisor=null;
  if(!service&&needsSupervisor(actor)){need(role(data.supervisor)==='PM'&&data.supervisor!==actor,'Select your supervisor.');supervisor=data.supervisor;}
  if(!service)need(validDate(invoice.invoiceDate),'Enter the expense date.');
  const background=text(data.background),purpose=text(data.purpose),approach=text(data.approach);
  if(service)need(text(data.title)&&background&&purpose&&approach,'Describe the service, background, why it is needed and how it will be delivered.');
  const attachments=copy(data.attachments||[]);filesValid(attachments);
  return {...invoice,kind:data.kind,title:service?text(data.title):`${kinds[data.kind]} · ${invoice.invoiceDate}`,background:service?background:'',purpose:service?purpose:'',approach:service?approach:'',supervisor,amount,projectId:project?.id||null,attachments};
}
export function createBusinessRequest(state,data,actor){const fields=validateRequest(state,data,actor);const r={...fields,id:uid('request'),reference:`REQ-${Date.now().toString(36).toUpperCase()}-${ensureBusiness(state).requests.length+1}`,requester:actor,stage:'Draft',createdAt:new Date().toISOString(),history:[],decisions:[],quotes:[],payments:[],revision:0,processVersion:2,gates:{}};log(r,actor,'Created',kinds[r.kind]);ensureBusiness(state).requests.unshift(r);return r;}
export function updateBusinessRequest(state,id,data,actor){const r=get(state,id);need(r.requester===actor&&['Draft','Returned','Withdrawn','Customer changes'].includes(r.stage),'Only the requester can edit a draft, returned or withdrawn request.');need(!r.payments.some(p=>p.status==='Paid'),'A request with recorded payments cannot be changed.');const fields=validateRequest(state,{...data,kind:r.kind},actor);archive(r);Object.assign(r,fields,{budgetChange:null,budgetReturn:null,reviewReturn:null,quotes:[],selectedQuote:null,selectionReason:'',payments:[],approvedBudget:null,resumeStage:null,returnTo:null,stage:'Draft',decisions:[],gates:{},processVersion:2});log(r,actor,'Edited','Previous approvals invalidated; submit again.');return r;}
const get = (s,id) => ensureBusiness(s).requests.find(r=>r.id===id)||fail('Request not found.');
export function assignees(r){
  if(['Ready to pay','Payment review'].includes(r.stage)&&isFinalPayment(r)&&!currentPayment(r).acceptance?.approvedBy)return [r.requester];
  switch(r.stage){
    case 'Corporation review':return ['alex','jamie'].flatMap(id=>r.decisions.includes(id)?[]:reviewer(r,id));
    case 'Supervisor review':return reviewer(r,r.route.supervisor);
    case 'PM review':return reviewer(r,r.route.pm);
    case 'Budget review':case 'Supplier review':return Object.entries(gateReviewers(r)).filter(([key])=>!gateVotes(r)[key]).map(([,id])=>id);
    case 'Finance review':case 'Payment setup':case 'Payment review':case 'Ready to pay':return reviewer(r,'jamie');
    case 'Director review':case 'Final acceptance':return reviewer(r,r.route.director);
    case 'Customer confirmation':return [r.customerReview?.customerId].filter(Boolean);
    case 'Customer changes':case 'Draft':case 'Returned':case 'Withdrawn':case 'Sourcing':case 'Payment documents':return [r.requester];
    default:return [];
  }
}
export function allowedActions(r,actor){const own=actor===r.requester,assigned=assignees(r).includes(actor),a=[];if(own&&['Draft','Returned','Withdrawn','Customer changes'].includes(r.stage)){if(!r.payments.some(p=>p.status==='Paid'))a.push('edit');a.push('submit');}if(assigned&&!own&&['Corporation review','Supervisor review','PM review','Finance review','Supplier review','Budget review','Director review','Payment review','Final acceptance'].includes(r.stage))a.push('approve','return');if(canLodge(r,actor))a.push('lodge');if(own&&r.stage==='Sourcing')a.push('source');if(assigned&&r.stage==='Payment setup')a.push('plan');if(own&&(r.stage==='Payment documents'||['Ready to pay','Payment review'].includes(r.stage)&&isFinalPayment(r)&&!currentPayment(r).acceptance?.approvedBy))a.push('documents');if(assigned&&r.stage==='Ready to pay'&&(!isFinalPayment(r)||currentPayment(r).acceptance?.approvedBy))a.push('paid');if(['Admin','Finance'].includes(role(actor))&&r.kind!=='corporation'&&!['Draft','Returned','Withdrawn','Director review','Completed','Cancelled','Budget review','Customer confirmation','Customer changes'].includes(r.stage)&&!own)a.push('escalate');if(own&&!['Draft','Withdrawn','Completed','Cancelled'].includes(r.stage)&&!r.payments.some(p=>p.status==='Paid'))a.push('withdraw');if(own&&!['Completed','Cancelled'].includes(r.stage))a.push('cancel');return a;}
function allowed(r,actor,action){need(allowedActions(r,actor).includes(action),'This action is not available for your role at this stage.');}
function reimbursementReady(r){r.payments=[{id:uid('payment'),label:'Reimbursement',amount:r.amount,dueDate:'',method:'To be recorded',requirements:'Approved receipt and supporting evidence',status:'Ready',files:copy(r.attachments),submissions:[]}];r.stage='Ready to pay';}
function paymentStage(r){const p=r.payments.find(p=>p.status!=='Paid');r.stage=p?({Pending:'Payment documents',Review:'Payment review',Ready:'Ready to pay'}[p.status]):'Completed';}
export function currentPayment(r){return r.payments.find(p=>p.status!=='Paid');}
export function actBusiness(state,id,actor,action,data={}){
  const r=get(state,id);allowed(r,actor,action);
  if(action==='submit'){
    if(r.stage==='Returned'&&r.returnTo==='Payment documents'){r.stage='Payment documents';r.returnTo=null;log(r,actor,'Resumed payment documents');return r;}
    if(r.stage==='Returned'&&r.returnTo==='Sourcing'){r.stage='Sourcing';r.returnTo=null;log(r,actor,'Resumed supplier preparation');return r;}
    if(r.stage==='Withdrawn'&&r.resumeStage&&r.kind==='service'){r.stage=r.resumeStage;r.resumeStage=null;r.decisions=[];if(['Budget review','Supplier review'].includes(r.stage)){r.gates??={};r.gates[r.stage]={};}if(r.stage==='Ready to pay')r.stage='Payment review';if(r.stage==='Customer confirmation')beginCustomerReview(state,r,r.customerReview?.resumeStage);log(r,actor,'Resubmitted',r.stage);return r;}
    const fields=validateRequest(state,r,actor);if(r.kind!=='service')filesValid(fields.attachments,true);
    const p=projectFor(state,r);r.route=r.kind==='corporation'?{director:'sam',supervisor:fields.supervisor}:{pm:p.pm,director:p.director,threshold:p.threshold,projectName:p.name,supervisor:fields.supervisor};r.stage=r.kind==='service'?'Budget review':fields.supervisor?'Supervisor review':r.kind==='corporation'?'Corporation review':'PM review';r.gates={};r.decisions=[];r.payments=[];r.resumeStage=null;r.returnTo=null;r.budgetReturn=null;r.budgetChange=null;r.reviewReturn=null;r.revision++;if(r.kind==='service')beginCustomerReview(state,r);log(r,actor,'Submitted',`Revision ${r.revision} · ${r.stage}`);
  } else if(action==='lodge'){filesValid(data.files);return lodgeCompletion(r,actor,data);
  } else if(action==='approve'){
    const stage=r.stage;
    if(stage==='Corporation review'){for(const id of ['alex','jamie'])if(!r.decisions.includes(id)&&reviewer(r,id).includes(actor))r.decisions.push(id);if(r.decisions.length===2)reimbursementReady(r);}
    if(stage==='Supervisor review'){if(r.kind==='corporation')r.stage='Corporation review';else if(r.route.supervisor===r.route.pm)afterPM(r);else r.stage='PM review';}
    if(stage==='PM review')afterPM(r);
    if(stage==='Director review'){r.stage=r.reviewReturn||'Finance review';r.reviewReturn=null;}
    if(['Budget review','Supplier review'].includes(stage)){r.gates??={};r.gates[stage]??={};const gate=Object.entries(gateReviewers(r)).find(([key,id])=>id===actor&&!r.gates[stage][key]);need(gate,'You have already approved this stage.');r.gates[stage][gate[0]]={actor,at:new Date().toISOString()};if(r.gates[stage].finance&&r.gates[stage].director){if(stage==='Budget review'){r.approvedBudget=r.budgetChange||r.amount;r.budgetChange=null;r.stage=r.budgetReturn||'Sourcing';r.budgetReturn=null;}else r.stage='Payment setup';}}
    if(stage==='Finance review')reimbursementReady(r);
    if(stage==='Final acceptance'){const p=currentPayment(r);need(p.acceptance?.files?.length&&p.acceptance.summary,'Acceptance evidence is required for the final payment.');p.acceptance.approvedBy=actor;p.acceptance.approvedAt=new Date().toISOString();r.stage='Payment review';}
    if(stage==='Payment review'){const p=currentPayment(r);need(!isFinalPayment(r)||p.acceptance?.approvedBy,'Director must approve final acceptance before the final payment.');p.status='Ready';r.stage='Ready to pay';}
    log(r,actor,'Approved',stage);
  } else if(action==='return'){
    need(text(data.reason),'Explain what needs to change.');const from=r.stage;
    r.returnTo=['Payment review','Final acceptance'].includes(from)?'Payment documents':from==='Supplier review'?'Sourcing':null;
    if(from==='Director review')r.returnTo=['Payment documents','Payment review','Ready to pay','Final acceptance'].includes(r.reviewReturn)?'Payment documents':r.reviewReturn==='Supplier review'?'Sourcing':null;
    r.stage='Returned';r.decisions=[];r.gates??={};if(['Budget review','Supplier review'].includes(from))r.gates[from]={};if(r.returnTo==='Payment documents'){currentPayment(r).status='Pending';if(currentPayment(r).acceptance){currentPayment(r).acceptance.approvedBy=null;currentPayment(r).acceptance.approvedAt=null;}}log(r,actor,'Returned for changes',`${from}: ${text(data.reason)}`);
  } else if(action==='escalate'){
    need(text(data.reason),'Explain why Director review is needed.');need(role(data.director)==='Director'&&data.director!==r.requester,'Choose an independent Director.');r.route.director=data.director;r.reviewReturn=r.stage;r.stage='Director review';log(r,actor,'Escalated to Director',`${data.director}: ${text(data.reason)}`);
  } else if(action==='withdraw'){
    need(text(data.reason),'Give a reason for withdrawal.');r.resumeStage=r.stage==='Returned'?null:r.stage;r.stage='Withdrawn';log(r,actor,'Withdrawn',text(data.reason));
  } else if(action==='cancel'){
    need(text(data.reason),'Give a reason for cancellation.');for(const p of r.payments)if(p.status!=='Paid')p.status='Cancelled';r.stage='Cancelled';log(r,actor,'Cancelled',text(data.reason));
  } else if(action==='source'){
    need(Array.isArray(data.quotes)&&data.quotes.length,'Add at least one supplier quote.');const quotes=data.quotes.map(q=>{need(text(q.supplier),'Enter each supplier name.');filesValid(q.quoteFiles,true);filesValid(q.contractFiles,true);return {id:q.id||uid('quote'),supplier:text(q.supplier),amount:cents(q.amount)/100,quoteFiles:copy(q.quoteFiles),contractFiles:copy(q.contractFiles),abnCheck:q.abnCheck?copy(q.abnCheck):null};});need(new Set(quotes.map(q=>q.id)).size===quotes.length,'Duplicate quote IDs.');const chosen=quotes[Number(data.selectedIndex)];need(chosen,'Select one supplier.');need(text(data.reason),'Explain why this supplier was chosen.');if(r.quotes.length)archive(r);r.quotes=quotes;r.selectedQuote=chosen.id;r.selectionReason=text(data.reason);r.stage='Supplier review';r.gates??={};r.gates['Supplier review']={};if(chosen.amount>r.approvedBudget){r.stage='Budget review';r.gates['Budget review']={};r.budgetChange=chosen.amount;r.budgetReturn='Supplier review';if(r.customerReview&&chosen.amount>r.customerReview.snapshot.amount)beginCustomerReview(state,r);}log(r,actor,'Suppliers submitted',`${chosen.supplier} · AUD ${chosen.amount} · ${r.selectionReason}${r.budgetChange?' · Budget increase requires Director and Finance pre-approval':''}`);
  } else if(action==='plan'){
    need(Array.isArray(data.payments)&&data.payments.length>0,'Add at least one payment.');const payments=data.payments.map(p=>{need(text(p.label),'Describe each payment milestone.');need(validDate(p.dueDate),'Enter a valid expected payment date.');need(['Bank transfer','Card','BPAY','Other'].includes(p.method),'Select a payment method.');need(text(p.requirements),'Specify required payment documents.');return {id:uid('payment'),label:text(p.label),amount:cents(p.amount)/100,dueDate:p.dueDate,method:p.method,requirements:text(p.requirements),status:'Pending',files:[],submissions:[]};});need(payments.reduce((n,p)=>n+Math.round(p.amount*100),0)===Math.round(businessAmount(r)*100),'Payment amounts must equal the approved total.');need(payments.every((p,i)=>i===0||p.dueDate>=payments[i-1].dueDate),'Payment dates must be in chronological order.');r.payments=payments;r.stage='Payment documents';log(r,actor,'Payment plan approved',payments.map(p=>`${p.label}: AUD ${p.amount} · ${p.dueDate} · ${p.method} · ${p.requirements}`).join('\n'));
  } else if(action==='documents'){
    filesValid(data.files,true);const p=currentPayment(r);const final=isFinalPayment(r);if(final){filesValid(data.acceptanceFiles||[],true);need(text(data.acceptanceSummary),'Describe what was completed and how it was accepted.');}p.files=copy(data.files);p.acceptance=final?{files:copy(data.acceptanceFiles),summary:text(data.acceptanceSummary),submittedBy:actor,approvedBy:null}:null;p.submissions.push({at:new Date().toISOString(),actor,files:copy(data.files),note:text(data.note),acceptance:copy(p.acceptance)});p.status='Review';r.stage=final?'Final acceptance':'Payment review';log(r,actor,'Payment documents submitted',`${p.label}${data.note?': '+text(data.note):''}`);
  } else if(action==='paid'){
    need(text(data.reference),'Enter the actual payment reference.');need(!r.payments.some(p=>p.status==='Paid'&&p.paymentReference===text(data.reference)),'This payment reference has already been recorded on the request.');need(validDate(data.date),'Enter the actual payment date.');need(data.date<=new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Melbourne',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),'Actual payment date cannot be in the future.');filesValid(data.files,true);const p=currentPayment(r);need(!isFinalPayment(r)||p.acceptance?.approvedBy,'Final payment needs Director-approved acceptance.');if(r.kind!=='service'){need(['Bank transfer','Card','BPAY','Other'].includes(data.method),'Select the actual payment method.');p.method=data.method;}p.status='Paid';p.paidAt=data.date;p.paymentReference=text(data.reference);p.proof=copy(data.files);log(r,actor,'Payment recorded',`${p.label} · AUD ${p.amount} · ${p.paymentReference} · ${p.paidAt}`);paymentStage(r);
  }
  return r;
}
