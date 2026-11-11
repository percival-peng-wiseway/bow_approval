import {signing,bankVerification} from './support/service-v2.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {saveProject,createBusinessRequest,actBusiness,allowedActions,assignees} from '../app/business.mjs';
import {needsAction} from '../app/workspace-model.mjs';
import {supplierRegister} from '../app/suppliers.mjs';
const file={name:'service-contract.txt',data:'data:text/plain;base64,Y29udHJhY3Q=',size:8};
function fixture(){const s={},p=saveProject(s,{name:'Contract site',pm:'taylor',director:'sam'},'alex'),r=createBusinessRequest(s,{kind:'service',payingEntity:'Test Development Pty Ltd',projectId:p.id,title:'Survey',background:'New build',approach:'Report',amount:1000},'pm-b');delete r.invoiceFlowVersion;const act=(actor,action,data)=>actBusiness(s,r.id,actor,action,data);act('pm-b','submit');act('jamie','approve');act('sam','approve');return {s,r,act};}
function selected(){const f=fixture();f.act('pm-b','source',{quotes:[{supplier:'Surveyor',amount:1000,quoteFiles:[file]}],selectedIndex:0,reason:'Qualified'});f.act('jamie','approve');f.act('sam','approve');return f;}
test('Quote selection needs no contract or ABN; only the requester prepares the approved supplier contract',()=>{
 const {s,r,act}=selected();assert.equal(r.stage,'Contract preparation');assert.deepEqual(assignees(r),['pm-b']);assert.equal(needsAction(r,'pm-b'),true);assert.equal(needsAction(r,'taylor'),false);assert.ok(!allowedActions(r,'taylor').includes('contract'));assert.throws(()=>act('taylor','contract',{files:[file],amount:1000}));assert.throws(()=>act('jamie','plan',{payments:[]}));
 act('pm-b','contract',{files:[file],amount:1000,abn:'51824753556',paymentTerms:'30 days'});assert.equal(r.stage,'Contract preparation');assert.equal(r.serviceContract.analysis,null);assert.equal(r.serviceContract.uploadedBy,'pm-b');assert.equal(supplierRegister(s).length,1);assert.equal(supplierRegister(s)[0].abn,'51824753556');
 act('pm-b','contract',{files:[file],amount:1000,submit:true});assert.equal(r.stage,'Contract review');assert.deepEqual(assignees(r),['jamie']);assert.throws(()=>act('sam','approve'));assert.throws(()=>act('pm-b','contract',{files:[file],amount:1000}));act('jamie','approve');assert.equal(r.stage,'Contract signing');assert.equal(r.serviceContract.approvedBy,'jamie');
});
test('Finance returns directly to requester; changed files invalidate earlier report; contract amount cannot bypass budget approval',()=>{
 const {r,act}=selected();assert.throws(()=>act('pm-b','contract',{files:[],amount:1000}),/Upload/);assert.throws(()=>act('pm-b','contract',{files:[file],amount:1100}),/match/);
 act('pm-b','contract',{files:[file],amount:1000,submit:true});act('jamie','return',{reason:'Clarify payment milestones'});assert.equal(r.stage,'Contract preparation');assert.equal(r.serviceContract.returnReason,'Clarify payment milestones');act('pm-b','contract',{files:[file],amount:1000,notes:'Updated',submit:true});assert.equal(r.contractHistory.length,1);assert.equal(r.serviceContract.analysis,null);act('jamie','approve');assert.equal(r.stage,'Contract signing');
});
test('Withdraw pauses requester and Finance actions; resubmit resumes review and cancellation prevents payment setup',()=>{const {r,act}=selected();act('pm-b','contract',{files:[file],amount:1000,submit:true});act('pm-b','withdraw',{reason:'Pause'});assert.throws(()=>act('jamie','approve'));act('pm-b','submit');assert.equal(r.stage,'Contract review');act('pm-b','cancel',{reason:'Cancelled work'});assert.throws(()=>act('jamie','approve'));});

test('A preliminary price range and service description can be reviewed without quote or contract files',()=>{
 const {r,act}=fixture();
 act('pm-b','source',{quotes:[{supplier:'Surveyor',priceMin:700,amount:1000,serviceScope:'Site survey and certified report.'}],selectedIndex:0,reason:'Relevant experience'});
 assert.equal(r.stage,'Supplier review');assert.equal(r.quotes[0].priceMin,700);assert.equal(r.quotes[0].serviceScope,'Site survey and certified report.');assert.deepEqual(r.quotes[0].quoteFiles,[]);
 act('jamie','approve');act('sam','approve');assert.equal(r.stage,'Contract preparation');
 assert.throws(()=>act('pm-b','contract',{files:[file],amount:1001,submit:true}),/approved price range/);
 assert.throws(()=>act('pm-b','contract',{files:[file],amount:699,submit:true}),/approved price range/);
 assert.throws(()=>act('pm-b','contract',{files:[],amount:800,submit:true}),/Upload/);
 act('pm-b','contract',{files:[file],amount:800,submit:true});act('jamie','approve');
 act('pm-b','sign-contract',signing([file]));act('jamie','verify-bank',bankVerification);
 const payment=amount=>({kind:'Final',label:'Final payment',amount,dueDate:'2027-01-01',method:'Bank transfer',requirements:'Invoice and acceptance'});
 assert.throws(()=>act('jamie','plan',{payments:[payment(1000)]}),/remaining contract balance/);
 act('jamie','plan',{payments:[payment(800)]});assert.equal(r.stage,'Payment documents');assert.equal(r.payments[0].amount,800);assert.equal(r.quotes[0].amount,1000);
});
test('Preliminary proposal validation preserves budget escalation and rejects missing or invalid scope and prices',()=>{
 const {r,act}=fixture();const source=q=>act('pm-b','source',{quotes:[{supplier:'Surveyor',priceMin:700,amount:1000,serviceScope:'Survey',...q}],selectedIndex:0,reason:'Qualified'});
 for(const q of [{priceMin:1001},{priceMin:''},{priceMin:-1},{amount:'NaN'},{serviceScope:''},{serviceScope:'a'.repeat(3001)}])assert.throws(()=>source(q));
 assert.equal(r.stage,'Sourcing');assert.equal(r.quotes.length,0);
 source({priceMin:900,amount:1200});assert.equal(r.stage,'Budget review');assert.equal(r.budgetChange,1200);
 act('jamie','approve');act('sam','approve');assert.equal(r.approvedBudget,1200);assert.equal(r.stage,'Supplier review');
});

test('Requester bank details persist with the contract and can be corrected on Finance return',()=>{
 const {r,act}=selected();assert.throws(()=>act('pm-b','contract',{files:[file],amount:1000,bankDetails:'x'.repeat(3001)}),/too long/);
 act('pm-b','contract',{files:[file],amount:1000,bankDetails:'Test payee · BSB 000000 · Account 123456',submit:true});assert.equal(r.serviceContract.bankDetails,'Test payee · BSB 000000 · Account 123456');
 act('jamie','return',{reason:'Confirm bank details'});act('pm-b','contract',{files:[file],amount:1000,bankDetails:'',submit:true});assert.equal(r.serviceContract.bankDetails,'');assert.equal(r.contractHistory[0].bankDetails,'Test payee · BSB 000000 · Account 123456');
});
