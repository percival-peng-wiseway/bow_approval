import {signing,bankVerification,invoiceData} from './support/service-v2.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {saveCustomerAccess,customerAccess,saveCustomer,customerDecision,customerView,customerFiles} from '../app/customer-domain.mjs';
import {saveProject,createBusinessRequest,actBusiness,updateBusinessRequest} from '../app/business.mjs';
import {sendCustomerMail,reconcileCustomerMail,flushCustomerMail} from '../server/customer-service.mjs';
const file={name:'internal.txt',data:'data:text/plain;base64,c2VjcmV0',size:6};
function fixture(){const s={business:{projects:[],requests:[]}},c=saveCustomer(s,{name:'Customer A',email:'a@example.invalid'},'alex'),other=saveCustomer(s,{name:'Customer B',email:'b@example.invalid'},'alex');const p=saveProject(s,{name:'Client site',pm:'taylor',director:'sam',customerId:c.id,threshold:10000},'alex');const r=createBusinessRequest(s,{kind:'service',payingEntity:'Test Development Pty Ltd',notifyCustomer:true,projectId:p.id,title:'Survey',background:'Site constraints',purpose:'Design safely',approach:'Site visit',amount:1000,attachments:[file]},'taylor');actBusiness(s,r.id,'taylor','submit');return {s,c,other,p,r};}
const decide=(s,r,c,decision='approve',comment='')=>customerDecision(s,c.id,{id:r.id,reviewId:r.customerReview.id,decision,comment});
const act=(s,r,id,a,data)=>actBusiness(s,r.id,id,a,data);
test('customer confirmation blocks internal approvals, isolates projects and rejects stale or repeat decisions',()=>{const {s,c,other,r}=fixture();assert.equal(r.stage,'Customer confirmation');assert.throws(()=>act(s,r,'sam','approve'));assert.throws(()=>decide(s,r,other));assert.equal(customerView(s,other.id).projects.length,0);const view=JSON.stringify(customerView(s,c.id));assert.ok(!view.includes(file.data));assert.ok(!view.includes('decisions'));assert.ok(!view.includes('history'));const old=r.customerReview.id;decide(s,r,c);assert.equal(r.stage,'Budget review');assert.throws(()=>customerDecision(s,c.id,{id:r.id,reviewId:old,decision:'approve'}));act(s,r,'sam','approve');act(s,r,'jamie','approve');assert.equal(r.stage,'Sourcing');});
test('changes, scope revisions and withdrawn confirmations require a fresh customer response',()=>{const {s,c,r}=fixture();assert.throws(()=>decide(s,r,c,'changes'));const old=r.customerReview.id;decide(s,r,c,'changes','Please clarify deliverables');assert.equal(r.stage,'Customer changes');updateBusinessRequest(s,r.id,{...r,amount:1500},'taylor');act(s,r,'taylor','submit');assert.notEqual(r.customerReview.id,old);assert.equal(r.customerReview.snapshot.amount,1500);assert.throws(()=>customerDecision(s,c.id,{id:r.id,reviewId:old,decision:'approve'}));act(s,r,'taylor','withdraw',{reason:'Update shortly'});assert.throws(()=>decide(s,r,c));const withdrawn=r.customerReview.id;act(s,r,'taylor','submit');assert.notEqual(r.customerReview.id,withdrawn);});
test('over-budget supplier needs new customer confirmation before internal budget review',()=>{const {s,c,r}=fixture();decide(s,r,c);act(s,r,'sam','approve');act(s,r,'jamie','approve');act(s,r,'taylor','source',{quotes:[{supplier:'Supplier',amount:1200,quoteFiles:[file],contractFiles:[file]}],selectedIndex:0,reason:'Required scope'});assert.equal(r.stage,'Customer confirmation');assert.equal(r.customerReview.snapshot.amount,1200);assert.throws(()=>act(s,r,'jamie','approve'));decide(s,r,c);act(s,r,'sam','approve');act(s,r,'jamie','approve');assert.equal(r.stage,'Supplier review');});
test('completed work is archived, only explicitly published documents are exposed, ownership is locked',()=>{const {s,c,p,r}=fixture();delete r.invoiceFlowVersion;assert.throws(()=>saveProject(s,{...p,customerId:''},'alex'));decide(s,r,c);act(s,r,'sam','approve');act(s,r,'jamie','approve');act(s,r,'taylor','source',{quotes:[{supplier:'Supplier',amount:1000,quoteFiles:[file],contractFiles:[file]}],selectedIndex:0,reason:'Suitable'});act(s,r,'sam','approve');act(s,r,'jamie','approve');act(s,r,'taylor','contract',{files:[file],amount:1000,submit:true});act(s,r,'jamie','approve');act(s,r,'taylor','sign-contract',signing([file]));act(s,r,'jamie','verify-bank',bankVerification);act(s,r,'jamie','plan',{payments:[{kind:'Final',label:'Final',amount:1000,dueDate:'2026-10-26',method:'Bank transfer',requirements:'Invoice'}]});act(s,r,'taylor','documents',{...invoiceData,files:[file],note:'Invoice',acceptanceSummary:'Delivered and accepted',acceptanceFiles:[file]});act(s,r,'sam','approve',{note:'Independently inspected'});act(s,r,'sam','approve');act(s,r,'jamie','approve');act(s,r,'jamie','paid',{reference:'TEST',date:'2026-10-26',files:[file]});assert.equal(r.stage,'Completed');assert.equal(customerView(s,c.id).projects[0].requests[0].status,'Completed');assert.equal(customerFiles(s,c.id).length,0);const published={name:'deliverable.txt',data:'data:text/plain;base64,ZG9uZQ==',size:4};act(s,r,'taylor','lodge',{summary:'Survey complete',files:[published]});assert.deepEqual(customerFiles(s,c.id),[published]);assert.ok(!JSON.stringify(customerView(s,c.id)).includes(file.data));saveCustomer(s,{...c,active:false},'alex');assert.throws(()=>customerView(s,c.id));});
test('email failures are not reported as sent; configured sends use a stable idempotency key',async()=>{const mail={id:'review-1',to:'a@example.invalid',subject:'Scope confirmation',text:'Please review'};assert.equal((await sendCustomerMail(mail,{})).status,'queued');let key;const env={RESEND_API_KEY:'fake-test-key',EMAIL_FROM:'test@example.invalid',PUBLIC_APP_URL:'https://portal.example.invalid'};assert.equal((await sendCustomerMail(mail,env,async(u,o)=>{key=o.headers['Idempotency-Key'];return Response.json({id:'provider-test'});})).status,'accepted');assert.equal(key,mail.id);assert.equal((await sendCustomerMail(mail,env,async()=>new Response('',{status:500}))).status,'failed');});

test('Customer confirmation is opt-in for new services; internal-only requests never queue confirmation mail',async()=>{
 const {s,p,c}=fixture();s.business.requests=[];
 const r=createBusinessRequest(s,{kind:'service',payingEntity:'Test Development Pty Ltd',projectId:p.id,title:'Internal survey',background:'Prepare work',approach:'Survey',amount:1000},'taylor');
 assert.equal(r.notifyCustomer,false);act(s,r,'taylor','submit');assert.equal(r.stage,'Budget review');assert.equal(r.customerReview,undefined);
 const queued=[];await reconcileCustomerMail({read:async()=>({state:s}),enqueue:async m=>queued.push(m)},{PUBLIC_APP_URL:'http://127.0.0.1:4185'});assert.equal(queued.length,0);
 act(s,r,'sam','approve');act(s,r,'jamie','approve');assert.equal(r.stage,'Sourcing');
 act(s,r,'taylor','source',{quotes:[{supplier:'Surveyor',amount:1200,quoteFiles:[file],contractFiles:[file]}],selectedIndex:0,reason:'Qualified'});
 assert.equal(r.stage,'Budget review');assert.equal(r.customerReview,undefined);
 assert.equal(customerView(s,c.id).projects[0].requests[0].status,'In progress');
});
test('Withdrawing and disabling customer confirmation archives the prior review and invalidates its mail and response',async()=>{
 const {s,p,c,r}=fixture(),old=structuredClone(r.customerReview);act(s,r,'taylor','withdraw',{reason:'Update confirmation preference'});
 updateBusinessRequest(s,r.id,{...r,notifyCustomer:false},'taylor');
 assert.equal(r.customerReview,null);assert.equal(r.customerReviews.at(-1).id,old.id);act(s,r,'taylor','submit');assert.equal(r.stage,'Budget review');
 assert.throws(()=>customerDecision(s,c.id,{id:r.id,reviewId:old.id,decision:'approve'}));
 let sent=false,result;const pending={id:old.id,kind:'confirmation',customerId:c.id,requestId:r.id,reviewId:old.id,status:'queued'};
 await flushCustomerMail({pending:async()=>[pending],claim:async()=>pending,read:async()=>({state:s}),finish:async(m,v)=>{result=v;}},{},async()=>{sent=true;});
 assert.equal(sent,false);assert.equal(result.status,'cancelled');
 act(s,r,'taylor','withdraw',{reason:'Request customer confirmation'});updateBusinessRequest(s,r.id,{...r,notifyCustomer:true},'taylor');act(s,r,'taylor','submit');assert.equal(r.stage,'Customer confirmation');assert.notEqual(r.customerReview.id,old.id);
});
test('Legacy requests retain customer confirmation and explicit opt-in requires an active project customer',()=>{
 const {s,p,c,r}=fixture();act(s,r,'taylor','withdraw',{reason:'Update confirmation preference'});delete r.notifyCustomer;act(s,r,'taylor','submit');assert.equal(r.stage,'Customer confirmation');
 c.active=false;
 assert.throws(()=>createBusinessRequest(s,{kind:'service',payingEntity:'Test Development Pty Ltd',notifyCustomer:true,projectId:p.id,title:'Survey',background:'Work',approach:'Visit',amount:100},'taylor'),/active customer/);
 const internal=createBusinessRequest(s,{kind:'service',payingEntity:'Test Development Pty Ltd',notifyCustomer:false,projectId:p.id,title:'Survey',background:'Work',approach:'Visit',amount:100},'taylor');act(s,internal,'taylor','submit');assert.equal(internal.stage,'Budget review');
});


test('Customer access settings are admin-only and cannot strand pending confirmations',()=>{
 const {s,p}=fixture(),data={enabled:true,role:'viewer',visibility:'shared',defaultConfirmation:false};
 assert.throws(()=>saveCustomerAccess(s,'sam',{projectId:p.id,data}),/Only Admin/);
 assert.throws(()=>saveCustomerAccess(s,'alex',{projectId:p.id,data}),/pending customer confirmations/);
 assert.throws(()=>saveCustomerAccess(s,'alex',{projectId:p.id,data:{...data,defaultConfirmation:true}}),/active Approver/);
 assert.deepEqual(customerAccess(p),{enabled:true,role:'approver',visibility:'all',defaultConfirmation:false,showBudget:true,showContracts:true,showCompletion:true});
});
test('Project visibility filters internal services and pauses project/file access without changing other projects',()=>{
 const {s,p,c,r}=fixture();decide(s,r,c);
 const internal=createBusinessRequest(s,{kind:'service',payingEntity:'Test Development Pty Ltd',projectId:p.id,title:'Internal work',background:'Internal scope',approach:'Report',amount:50,notifyCustomer:false},'taylor');act(s,internal,'taylor','submit');
 const second=saveProject(s,{name:'Other project',pm:'taylor',director:'sam',customerId:c.id},'alex');
 saveCustomerAccess(s,'alex',{projectId:p.id,data:{enabled:true,role:'viewer',visibility:'shared',defaultConfirmation:false}});
 let v=customerView(s,c.id);assert.deepEqual(v.projects.find(x=>x.id===p.id).requests.map(x=>x.id),[r.id]);assert.equal(v.projects[0].requests[0].canConfirm,false);
 saveProject(s,{...p,name:'Renamed'},'alex');assert.equal(customerAccess(p).role,'viewer');
 saveCustomerAccess(s,'alex',{projectId:p.id,data:{enabled:false,role:'viewer',visibility:'shared',defaultConfirmation:false}});
 assert.deepEqual(customerView(s,c.id).projects.map(x=>x.id),[second.id]);assert.deepEqual(customerFiles(s,c.id),[]);
});
test('Viewer permissions are enforced on customer decisions and new confirmation submission',()=>{
 const {s,p,c,r}=fixture();p.customerAccess={enabled:true,role:'viewer'};
 assert.throws(()=>decide(s,r,c),/approval access/);
 const next=createBusinessRequest(s,{kind:'service',payingEntity:'Test Development Pty Ltd',projectId:p.id,title:'Survey two',background:'Scope',approach:'Report',amount:100,notifyCustomer:true},'taylor');
 assert.throws(()=>act(s,next,'taylor','submit'),/active Approver/);
});
