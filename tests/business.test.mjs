import {serviceBackground} from '../app/service-description.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {ensureBusiness,saveProject,createBusinessRequest,updateBusinessRequest,actBusiness,allowedActions,assignees,currentPayment,isFinalPayment,gateVotes} from '../app/business.mjs';
const file={name:'receipt.txt',data:'data:text/plain;base64,ZXZpZGVuY2U=',size:8};
const setup=()=>{const s={};ensureBusiness(s);const p=saveProject(s,{name:'Project A',pm:'taylor',director:'sam',threshold:10000},'alex');return {s,p};};
// Preserve regression coverage for previously submitted service workflows without a v2 marker.
const create=(s,p,kind='reimbursement',amount=100,actor='employee')=>{const r=createBusinessRequest(s,{kind,payingEntity:'Test Development Pty Ltd',projectId:p?.id,title:'Engineering',background:'Site upgrade',purpose:'Resolve site constraints',approach:'Survey then design',invoiceDate:'2026-10-22',supervisor:'taylor',amount,attachments:[file]},actor);if(kind==='service')delete r.serviceFlowVersion;return r;};
const act=(s,r,actor,action,data)=>actBusiness(s,r.id,actor,action,data);
const quote=(amount,supplier='Vendor')=>({supplier,amount,quoteFiles:[file],contractFiles:[file]});
const approveGate=(s,r)=>{act(s,r,'sam','approve');act(s,r,'jamie','approve');};
const plan=(s,r,amounts=[r.amount])=>act(s,r,'jamie','plan',{payments:amounts.map((amount,i)=>({label:`Payment ${i+1}`,amount,dueDate:'2026-10-25',method:'Bank transfer',requirements:'Invoice'}))});
const contract=(s,r)=>{act(s,r,r.requester,'contract',{files:[file],amount:r.quotes.find(q=>q.id===r.selectedQuote).amount,submit:true});act(s,r,'jamie','approve');};
const prepared=(amounts=[40,60])=>{const {s,p}=setup();const r=create(s,p,'service',100,'taylor');act(s,r,'taylor','submit');approveGate(s,r);act(s,r,'taylor','source',{quotes:[quote(100)],selectedIndex:0,reason:'Value and availability'});approveGate(s,r);contract(s,r);plan(s,r,amounts);return {s,p,r};};
const docs=(s,r)=>act(s,r,r.requester,'documents',{files:[file],acceptanceFiles:[file],acceptanceSummary:'Work inspected against agreed scope'});
const paid=(s,r,reference)=>act(s,r,'jamie','paid',{reference,date:'2026-10-22',files:[file],method:'Bank transfer'});

test('Company expenses require PM or management and go directly to both Admin and Finance',()=>{
 const {s}=setup(),fields={kind:'corporation',title:'Office supplies',amount:30,invoiceDate:'2026-10-22',attachments:[file],supervisor:'taylor'};
 for(const actor of ['employee','unknown']){const before=structuredClone(s);assert.throws(()=>createBusinessRequest(s,fields,actor));assert.deepEqual(s,before);}
 for(const actor of ['taylor','pm-b','alex','jamie','sam','admin']){const r=createBusinessRequest(s,fields,actor);assert.equal(r.supervisor,null);act(s,r,actor,'submit');assert.equal(r.stage,'Corporation review');assert.equal(r.route.supervisor,null);assert.ok(!assignees(r).includes(actor));}
 const r=createBusinessRequest(s,fields,'taylor');act(s,r,'taylor','submit');assert.deepEqual(assignees(r),['alex','jamie']);
 act(s,r,'jamie','approve');assert.equal(r.stage,'Corporation review');assert.deepEqual(assignees(r),['alex']);act(s,r,'alex','approve');assert.equal(r.stage,'Ready to pay');
 assert.throws(()=>createBusinessRequest(s,{...fields,invoiceDate:'2026-13-99'},'taylor'),/date/);
 const legacy={...structuredClone(r),id:'legacy',requester:'employee',stage:'Draft',payments:[],decisions:[]};s.business.requests.push(legacy);const before=structuredClone(legacy);assert.throws(()=>act(s,legacy,'employee','submit'),/Only PM/);assert.deepEqual(legacy,before);
});
test('Invoices are mandatory at submission and failed validation leaves requests unchanged',()=>{const {s,p}=setup();const r=create(s,p,'corporation',100,'taylor');r.attachments=[];const before=structuredClone(r);assert.throws(()=>act(s,r,'taylor','submit'),/Upload/);assert.deepEqual(r,before);assert.throws(()=>create(s,p,'corporation',0.001,'taylor'),/0.01/);});
test('Staff project reimbursements go directly to the responsible PM, then Finance',()=>{
 const {s,p}=setup();for(const amount of [1999.99,2000,2000.01,10000]){const r=create(s,p,'reimbursement',amount);assert.equal(r.supervisor,null);act(s,r,'employee','submit');assert.equal(r.stage,'PM review');assert.deepEqual(assignees(r),['taylor']);act(s,r,'taylor','approve');assert.equal(r.stage,'Finance review');assert.equal(!!r.directorNotice,amount>2000);act(s,r,'jamie','approve');assert.equal(r.stage,'Ready to pay');}
});
test('Manual Director escalation remains available for project reimbursements',()=>{const {s,p}=setup();const r=create(s,p);act(s,r,'employee','submit');act(s,r,'taylor','approve');act(s,r,'alex','escalate',{director:'director-b',reason:'Review evidence'});act(s,r,'director-b','approve');assert.equal(r.stage,'Finance review');});
test('Service pre-approval requires Director AND Finance; duplicates and stage skipping are blocked',()=>{const {s,p}=setup();const r=create(s,p,'service',100,'taylor');act(s,r,'taylor','submit');assert.deepEqual(assignees(r),['jamie','sam']);assert.throws(()=>act(s,r,'taylor','source',{quotes:[quote(90)],selectedIndex:0,reason:'Fit'}));act(s,r,'sam','approve');assert.equal(r.stage,'Budget review');assert.deepEqual(assignees(r),['jamie']);assert.throws(()=>act(s,r,'sam','approve'));assert.throws(()=>plan(s,r));act(s,r,'jamie','approve');assert.equal(r.stage,'Sourcing');assert.equal(r.approvedBudget,100);});
test('Supplier approval requires both before PM contract preparation and over-budget choices repeat both pre-approvals',()=>{const {s,p}=setup();const r=create(s,p,'service',100,'taylor');act(s,r,'taylor','submit');approveGate(s,r);act(s,r,'taylor','source',{quotes:[quote(110),quote(120,'Alternative')],selectedIndex:0,reason:'Better terms'});assert.equal(r.stage,'Budget review');assert.deepEqual(gateVotes(r),{});approveGate(s,r);assert.equal(r.stage,'Supplier review');act(s,r,'jamie','approve');assert.equal(r.stage,'Supplier review');assert.throws(()=>plan(s,r,[110]));act(s,r,'sam','approve');assert.equal(r.stage,'Contract preparation');contract(s,r);assert.equal(r.stage,'Payment setup');assert.throws(()=>plan(s,r,[100]),/equal/);plan(s,r,[40,70]);assert.equal(r.stage,'Payment documents');});
test('Final instalment requires acceptance evidence, Director sign-off and Finance payment review',()=>{const {s,r}=prepared();assert.equal(isFinalPayment(r),false);docs(s,r);assert.equal(r.stage,'Payment review');act(s,r,'jamie','approve');paid(s,r,'DEPOSIT');assert.equal(r.stage,'Payment documents');assert.equal(isFinalPayment(r),true);assert.throws(()=>act(s,r,'taylor','documents',{files:[file]}),/Upload/);docs(s,r);assert.equal(r.stage,'Final acceptance');assert.throws(()=>act(s,r,'jamie','approve'));assert.throws(()=>paid(s,r,'FINAL'));act(s,r,'sam','approve');assert.equal(r.stage,'Payment review');act(s,r,'jamie','approve');paid(s,r,'FINAL');assert.equal(r.stage,'Completed');assert.equal(r.payments[1].acceptance.approvedBy,'sam');assert.equal(r.payments[0].status,'Paid');assert.deepEqual(allowedActions(r,'taylor'),[]);});
test('A single payment is also final and returning payment documents invalidates acceptance',()=>{const {s,r}=prepared([100]);docs(s,r);assert.equal(r.stage,'Final acceptance');act(s,r,'sam','approve');act(s,r,'jamie','return',{reason:'Invoice needs correction'});assert.equal(currentPayment(r).acceptance.approvedBy,null);act(s,r,'taylor','submit');docs(s,r);assert.equal(r.stage,'Final acceptance');act(s,r,'sam','return',{reason:'Completion evidence insufficient'});act(s,r,'taylor','submit');docs(s,r);act(s,r,'sam','approve');act(s,r,'jamie','approve');paid(s,r,'FINAL');assert.equal(r.stage,'Completed');assert.equal(r.payments[0].submissions.length,3);});
test('Withdraw, edit, return and resubmit invalidate relevant dual votes and preserve documents',()=>{const {s,p}=setup();const r=create(s,p,'service',100,'taylor');act(s,r,'taylor','submit');act(s,r,'sam','approve');act(s,r,'taylor','withdraw',{reason:'Pause'});assert.throws(()=>act(s,r,'jamie','approve'));act(s,r,'taylor','submit');assert.deepEqual(gateVotes(r),{});approveGate(s,r);act(s,r,'taylor','source',{quotes:[quote(90)],selectedIndex:0,reason:'Fit'});act(s,r,'jamie','approve');act(s,r,'sam','return',{reason:'Contract terms'});act(s,r,'taylor','submit');act(s,r,'taylor','source',{quotes:[quote(95)],selectedIndex:0,reason:'Updated'});assert.deepEqual(gateVotes(r),{});act(s,r,'taylor','withdraw',{reason:'Scope change'});updateBusinessRequest(s,r.id,{...r,amount:200},'taylor');assert.equal(r.approvedBudget,null);assert.equal(r.quotes.length,0);assert.ok(r.archives.length);act(s,r,'taylor','submit');assert.equal(r.stage,'Budget review');});
test('Partial payments cannot be withdrawn or edited; cancellation preserves paid proof',()=>{const {s,r}=prepared();docs(s,r);act(s,r,'jamie','approve');paid(s,r,'DEPOSIT');assert.throws(()=>act(s,r,'taylor','withdraw',{reason:'Stop'}));assert.ok(!allowedActions(r,'taylor').includes('withdraw'));act(s,r,'taylor','cancel',{reason:'Remaining service cancelled'});assert.equal(r.payments[0].status,'Paid');assert.equal(r.payments[1].status,'Cancelled');assert.equal(r.payments[0].proof.length,1);});
test('No self approval and project settings are snapshotted',()=>{const {s,p}=setup();const r=create(s,p,'reimbursement',9000,'taylor');act(s,r,'taylor','submit');assert.ok(!assignees(r).includes('taylor'));saveProject(s,{...p,pm:'pm-b',threshold:100},'alex');assert.equal(r.route.pm,'taylor');assert.equal(r.route.noticeThreshold,2000);assert.equal(r.route.threshold,null);const service=create(s,p,'service',100,'sam');act(s,service,'sam','submit');assert.ok(!assignees(service).includes('sam'));assert.deepEqual(new Set(assignees(service)).size,2);const finance=create(s,p,'service',100,'jamie');act(s,finance,'jamie','submit');assert.deepEqual(assignees(finance),['alex','sam']);});

test('Previously ready final payments cannot bypass new acceptance requirement',()=>{const {s,r}=prepared([100]);const p=currentPayment(r);r.stage='Ready to pay';p.status='Ready';delete p.acceptance;assert.deepEqual(assignees(r),['taylor']);assert.ok(allowedActions(r,'taylor').includes('documents'));assert.ok(!allowedActions(r,'jamie').includes('paid'));assert.throws(()=>paid(s,r,'BYPASS'));r.stage='Payment review';assert.ok(!allowedActions(r,'taylor').includes('approve'));docs(s,r);assert.equal(r.stage,'Final acceptance');});
test('Incomplete service reports fail before creating a request',()=>{const {s,p}=setup();assert.throws(()=>createBusinessRequest(s,{kind:'service',payingEntity:'Test Development Pty Ltd',projectId:p.id,title:'Engineering',purpose:'Needed',amount:100},'employee'),/background/);assert.equal(s.business.requests.length,0);});

test('Service background combines legacy reasons and accepts one field for new requests',()=>{
 const {s,p}=setup();
 const fields={kind:'service',payingEntity:'Test Development Pty Ltd',projectId:p.id,title:'Engineering',background:'Survey needed before construction',approach:'Engage a surveyor',amount:100};
 const fresh=createBusinessRequest(s,fields,'taylor');
 assert.equal(fresh.purpose,'');
 act(s,fresh,'taylor','submit');
 assert.equal(fresh.stage,'Budget review');
 const legacy=create(s,p,'service',100,'taylor');
 const combined=serviceBackground(legacy);
 assert.equal(combined,'Site upgrade\n\nResolve site constraints');
 updateBusinessRequest(s,legacy.id,{...legacy,background:combined,purpose:''},'taylor');
 assert.equal(serviceBackground(legacy),combined);
 assert.equal(serviceBackground({background:'Same',purpose:'Same'}),'Same');
 assert.throws(()=>createBusinessRequest(s,{...fields,background:''},'taylor'),/background/);
});

test('Director acknowledgement is authorized, audited and never holds Finance or completed payment',()=>{
 const {s,p}=setup(),r=create(s,p,'reimbursement',2500);act(s,r,'employee','submit');act(s,r,'taylor','approve');
 assert.equal(r.directorNotice.recipient,'sam');assert.ok(allowedActions(r,'sam').includes('acknowledge'));assert.ok(!allowedActions(r,'sam').includes('approve'));
 assert.throws(()=>act(s,r,'director-b','acknowledge'));assert.throws(()=>act(s,r,'employee','acknowledge'));
 act(s,r,'jamie','approve');assert.equal(r.stage,'Ready to pay');
 act(s,r,'jamie','paid',{reference:'REIMBURSE-TEST',date:'2026-10-22',method:'Bank transfer',files:[file]});assert.equal(r.stage,'Completed');
 act(s,r,'sam','acknowledge');assert.equal(r.stage,'Completed');assert.equal(r.directorNotice.acknowledgedBy,'sam');assert.ok(r.directorNotice.acknowledgedAt);assert.equal(r.history.at(-1).action,'Director acknowledged');
 assert.throws(()=>act(s,r,'sam','acknowledge'));assert.equal(r.history.filter(e=>e.action==='Director acknowledged').length,1);
});
test('Returned or withdrawn expenses pause acknowledgement; resubmission creates a fresh notice',()=>{
 const {s,p}=setup(),r=create(s,p,'reimbursement',2500);act(s,r,'employee','submit');act(s,r,'taylor','approve');const first=r.directorNotice.id;
 act(s,r,'jamie','return',{reason:'Correct receipt'});assert.ok(!allowedActions(r,'sam').includes('acknowledge'));
 act(s,r,'employee','submit');assert.equal(r.stage,'PM review');assert.equal(r.directorNotice,null);act(s,r,'taylor','approve');assert.notEqual(r.directorNotice.id,first);assert.equal(r.directorNoticeHistory[0].id,first);
 act(s,r,'sam','acknowledge');act(s,r,'employee','withdraw',{reason:'Correct amount'});updateBusinessRequest(s,r.id,{...r,amount:2000},'employee');act(s,r,'employee','submit');act(s,r,'taylor','approve');assert.equal(r.directorNotice,null);assert.ok(r.directorNoticeHistory.at(-1).acknowledgedAt);
});
test('Director applicants are notified through another independent Director',()=>{
 const {s,p}=setup(),r=create(s,p,'reimbursement',2500,'sam');act(s,r,'sam','submit');act(s,r,'taylor','approve');assert.notEqual(r.directorNotice.recipient,'sam');assert.ok(allowedActions(r,r.directorNotice.recipient).includes('acknowledge'));
});
test('Existing in-flight reimbursement approvals keep their captured route',()=>{
 const {s,p}=setup(),r=create(s,p,'reimbursement',10000);act(s,r,'employee','submit');delete r.reimbursementFlowVersion;r.route.threshold=10000;act(s,r,'taylor','approve');assert.equal(r.stage,'Director review');assert.equal(r.directorNotice,undefined);
});
