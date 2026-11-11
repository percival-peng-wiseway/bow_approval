import test from 'node:test';
import assert from 'node:assert/strict';
import {serviceFixture,milestone,paymentEvidence,evidence,finishPayment} from './support/service-fixture.mjs';
import {signing,bankVerification} from './support/service-v2.mjs';
import {allowedActions,assignees,actBusiness,createBusinessRequest,saveProject,businessAmount} from '../app/business.mjs';
import {serviceTotal,projectFinancials} from '../app/service-controls.mjs';
import {needsAction} from '../app/workspace-model.mjs';
import {requestDocumentRows,paymentReadiness,homeGroups} from '../app/workspace-insights.mjs';
import {customerView,saveCustomer,customerDecision} from '../app/customer-domain.mjs';
import {supplierRegister} from '../app/suppliers.mjs';

test('v2 requires real signing and independently verified payment destination; role and stage skipping are blocked',()=>{
 const {s,r,act}=serviceFixture();assert.equal(r.serviceFlowVersion,2);assert.equal(r.executionVersion.name,'Service v2');assert.equal(r.stage,'Contract signing');
 assert.deepEqual(assignees(r),['pm-b']);assert.equal(needsAction(r,'pm-b'),true);assert.throws(()=>act('jamie','plan',{payments:[milestone(18000)]}));assert.throws(()=>act('taylor','sign-contract',signing([evidence])));
 for(const bad of [{files:[]},{authorityConfirmed:false},{signedDate:'2099-01-01'},{signatory:''}])assert.throws(()=>act('pm-b','sign-contract',{...signing([evidence]),...bad}));
 act('pm-b','sign-contract',signing([evidence]));assert.equal(r.stage,'Payment setup');assert.ok(!allowedActions(r,'jamie').includes('approve'));assert.ok(!allowedActions(r,'pm-b').includes('cancel'));assert.ok(!allowedActions(r,'pm-b').includes('withdraw'));
 assert.throws(()=>act('jamie','plan',{payments:[milestone(18000)]}),/verify/);assert.throws(()=>act('pm-b','verify-bank',bankVerification));assert.throws(()=>act('jamie','verify-bank',{...bankVerification,confirmed:false}));
 act('jamie','verify-bank',bankVerification);act('jamie','plan',{payments:[milestone(18000)]});assert.equal(r.stage,'Payment documents');assert.ok(requestDocumentRows(r).some(x=>x.category==='Executed contract'));assert.equal(homeGroups(s,'pm-b').action.length,1);
});
test('each milestone needs PM verification; only final and retention need Director acceptance',()=>{
 const f=serviceFixture({signed:true,verified:true}),{r,act}=f;act('jamie','plan',{payments:[milestone(3600,'Deposit / advance'),milestone(9000,'Progress'),milestone(5400)]});
 act('pm-b','documents',paymentEvidence('DEPOSIT'));assert.equal(r.stage,'PM delivery review');assert.equal(paymentReadiness(r,r.payments[0]).status,'PM verification');assert.throws(()=>act('pm-b','approve',{note:'Self'}));assert.throws(()=>act('jamie','approve'));assert.throws(()=>act('taylor','approve'),/verification/);
 act('taylor','approve',{note:'Advance required under signed contract'});assert.equal(r.stage,'Payment review');act('jamie','approve');assert.ok(!allowedActions(r,'jamie').includes('approve'));act('jamie','paid',{reference:'PAY-1',date:'2026-10-25',files:[evidence]});assert.equal(r.stage,'Payment documents');
 finishPayment(f,'PROGRESS');assert.equal(r.stage,'Payment documents');act('pm-b','documents',paymentEvidence('FINAL'));act('taylor','approve',{note:'Report delivered'});assert.equal(r.stage,'Final acceptance');assert.throws(()=>act('jamie','approve'));act('sam','approve');act('jamie','approve');act('jamie','paid',{reference:'PAY-3',date:'2026-10-25',files:[evidence]});assert.equal(r.stage,'Completed');assert.equal(r.payments.filter(p=>p.pmReview).length,3);
});
test('paying a full advance does not automatically complete the service',()=>{
 const f=serviceFixture({signed:true,verified:true}),{r,act}=f;act('jamie','plan',{payments:[milestone(18000,'Deposit / advance')]});finishPayment(f,'ADVANCE');assert.equal(r.stage,'Completion evidence');assert.throws(()=>act('sam','approve'));
 act('pm-b','complete-service',{summary:'Survey report delivered',files:[evidence]});assert.equal(r.stage,'Completion review');act('taylor','approve');assert.equal(r.stage,'Completion sign-off');act('sam','approve');assert.equal(r.stage,'Completed');assert.ok(r.completionAccepted);
});
test('PM applicants require independent delivery review; Finance applicants route payment controls to Admin',()=>{
 for(const requester of ['taylor','jamie']){const {r,act}=serviceFixture({requester,signed:true,verified:true}),finance=requester==='jamie'?'alex':'jamie';act(finance,'plan',{payments:[milestone(18000,'Progress')]});act(requester,'documents',paymentEvidence());assert.ok(!assignees(r).includes(requester));assert.ok(assignees(r).includes(requester==='taylor'?'sam':'taylor'));assert.throws(()=>act(requester,'approve',{note:'Self approval'}));}
});
test('a signed variation preserves original contract and paid evidence and replans only unpaid revised balance',()=>{
 const f=serviceFixture({signed:true,verified:true}),{s,p,r,act}=f;act('jamie','plan',{payments:[milestone(3600,'Deposit / advance'),milestone(14400)]});finishPayment(f,'DEPOSIT');const paid=structuredClone(r.payments[0]);
 act('pm-b','variation',{title:'Additional survey area',reason:'Added site area',delta:2000,timeImpact:'2 days',files:[evidence]});assert.equal(r.stage,'Variation review');assert.throws(()=>act('pm-b','documents',paymentEvidence()));assert.throws(()=>act('pm-b','sign-variation',signing([evidence])));act('jamie','approve');assert.equal(r.stage,'Variation review');assert.throws(()=>act('jamie','approve'));act('sam','approve');assert.equal(r.stage,'Variation review');act('director-b','approve');act('director-c','approve');assert.equal(r.stage,'Variation signing');assert.equal(serviceTotal(r),18000);
 act('pm-b','sign-variation',signing([evidence]));assert.equal(serviceTotal(r),20000);assert.equal(r.serviceContract.amount,18000);assert.deepEqual(r.payments,[paid]);assert.equal(r.paymentPlanHistory[0].payments.length,2);assert.equal(r.stage,'Payment setup');assert.throws(()=>act('jamie','plan',{payments:[milestone(20000)]}),/remaining/);act('jamie','plan',{payments:[milestone(16400)]});assert.equal(businessAmount(r),20000);assert.equal(projectFinancials(p,s.business.requests).available,10000);assert.equal(supplierRegister(s)[0].selectedValue,20000);finishPayment(f,'REVISED-FINAL');assert.equal(r.stage,'Completed');
});
test('returned variation keeps original commitments and scheduled balance; reductions below paid are rejected',()=>{
 const f=serviceFixture({signed:true,verified:true}),{r,act}=f;act('jamie','plan',{payments:[milestone(3600,'Deposit / advance'),milestone(14400)]});finishPayment(f,'FIRST');const before=structuredClone(r.payments);assert.throws(()=>act('pm-b','variation',{title:'Credit',reason:'Reduce work',delta:-16000,files:[evidence]}),/below/);
 act('taylor','variation',{title:'Extra area',reason:'Proposed',delta:1000,files:[evidence]});act('sam','return',{reason:'Stay within original scope'});assert.equal(r.stage,'Payment documents');assert.deepEqual(r.payments,before);assert.equal(serviceTotal(r),18000);assert.equal(r.variations[0].status,'Returned');
});
test('customer-related variations require separately recorded written consent, kept private by default',()=>{
 const {s,p,r,act}=serviceFixture({signed:true,verified:true});const c=saveCustomer(s,{name:'Test client',email:'client@example.invalid'},'alex');p.customerId=c.id;r.customerReview={customerId:c.id,status:'Approved',snapshot:{amount:20000},version:1};
 const v={title:'Scope addition',reason:'Client request',delta:1000,files:[evidence]};assert.throws(()=>act('pm-b','variation',v),/customer consent/);act('pm-b','variation',{...v,customerConfirmed:true,customerReference:'Client instruction 123',customerFiles:[evidence]});assert.equal(r.pendingVariation.customerConsent.reference,'Client instruction 123');assert.ok(!JSON.stringify(customerView(s,c.id)).includes('Client instruction 123'));
});
test('payment return clears approval and requires new PM verification; duplicate supplier invoice is blocked',()=>{
 const {r,act}=serviceFixture({signed:true,verified:true});act('jamie','plan',{payments:[milestone(9000,'Progress'),milestone(9000)]});act('pm-b','documents',paymentEvidence('INV-1'));act('taylor','approve',{note:'Checked'});act('jamie','return',{reason:'Wrong invoice'});assert.equal(r.payments[0].pmReview,null);act('pm-b','submit');assert.equal(r.stage,'Payment documents');act('pm-b','documents',paymentEvidence('INV-1'));act('taylor','approve',{note:'Corrected'});act('jamie','approve');act('jamie','paid',{reference:'FIRST',date:'2026-10-25',files:[evidence]});assert.throws(()=>act('pm-b','documents',paymentEvidence('INV-1')),/already recorded/);
});
test('retention respects defects period and cannot be accepted before its release date',()=>{
 const {r,act}=serviceFixture();act('pm-b','sign-contract',{...signing([evidence]),defectsUntil:'2099-01-01'});act('jamie','verify-bank',bankVerification);assert.throws(()=>act('jamie','plan',{payments:[milestone(18000,'Retention')]}),/defects/);act('jamie','plan',{payments:[milestone(18000,'Retention','2099-01-01')]});act('pm-b','documents',paymentEvidence());act('taylor','approve',{note:'Evidence received'});assert.throws(()=>act('sam','approve'),/release date/);assert.equal(r.stage,'Final acceptance');
});
test('version is server assigned; missing entity blocks new submissions; legacy route is retained',()=>{
 const s={},p=saveProject(s,{name:'Legacy site',pm:'taylor',director:'sam'},'alex'),r=createBusinessRequest(s,{kind:'service',projectId:p.id,title:'Survey',background:'Site',approach:'Report',amount:1000,serviceFlowVersion:1},'pm-b');assert.equal(r.serviceFlowVersion,2);assert.throws(()=>actBusiness(s,r.id,'pm-b','submit'),/legal entity/);delete r.serviceFlowVersion;actBusiness(s,r.id,'pm-b','submit');assert.equal(r.stage,'Budget review');
 const legacy=serviceFixture();delete legacy.r.serviceFlowVersion;legacy.r.stage='Contract review';legacy.act('jamie','approve');assert.equal(legacy.r.stage,'Payment setup');legacy.act('jamie','plan',{payments:[milestone(18000)]});legacy.act('pm-b','documents',{files:[evidence],acceptanceSummary:'Complete',acceptanceFiles:[evidence]});assert.equal(legacy.r.stage,'Final acceptance');
});
test('new services with a customer still require customer consent before internal approvals',()=>{
 const s={},c=saveCustomer(s,{name:'Client',email:'client@example.invalid'},'alex'),p=saveProject(s,{name:'Client development',pm:'taylor',director:'sam',payingEntity:'Test Dev Pty Ltd',customerId:c.id},'alex'),r=createBusinessRequest(s,{kind:'service',projectId:p.id,title:'Survey',background:'Site',approach:'Report',amount:20000,notifyCustomer:true},'pm-b');actBusiness(s,r.id,'pm-b','submit');assert.equal(r.stage,'Customer confirmation');assert.throws(()=>actBusiness(s,r.id,'sam','approve'));customerDecision(s,c.id,{id:r.id,reviewId:r.customerReview.id,decision:'approve'});assert.equal(r.stage,'Budget review');
});

test('contractual invoice due dates replace planned dates in payment reminders',async()=>{const {upcomingPayments}=await import('../app/workspace-model.mjs');const {s,p,r,act}=serviceFixture({signed:true,verified:true});act('jamie','plan',{payments:[milestone(18000)]});act('pm-b','documents',{...paymentEvidence(),invoiceDueDate:'2026-12-01'});assert.equal(upcomingPayments([r],'jamie',[p],'2026-11-01').length,0);assert.equal(upcomingPayments([r],'jamie',[p],'2026-11-25').length,1);});
test('supplier invoice duplicates are detected across requests and supplier aliases with the same ABN',()=>{
 const first=serviceFixture({signed:true,verified:true}),second=serviceFixture({signed:true,verified:true});first.r.serviceContract.abn=second.r.serviceContract.abn='51824753556';second.r.quotes[0].supplier='Alternate supplier trading name';first.s.business.requests.push(second.r);first.act('jamie','plan',{payments:[milestone(18000)]});first.act('pm-b','documents',paymentEvidence('SHARED-INV'));second.act('jamie','plan',{payments:[milestone(18000)]});assert.throws(()=>actBusiness(first.s,second.r.id,'pm-b','documents',paymentEvidence('SHARED-INV')),/already recorded/);
});
