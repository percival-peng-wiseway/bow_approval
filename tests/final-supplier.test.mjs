import test from 'node:test';
import assert from 'node:assert/strict';
import {createBusinessRequest,saveProject,actBusiness} from '../app/business.mjs';
import {contractRequest} from '../server/contract-ai.mjs';
const file={name:'contract.txt',size:8,data:'data:text/plain;base64,Y29udHJhY3Q='};
function fixture(alternative=900){const s={},p=saveProject(s,{name:'Final supplier test',pm:'taylor',director:'sam'},'alex'),r=createBusinessRequest(s,{kind:'service',payingEntity:'Test Development Pty Ltd',projectId:p.id,title:'Survey',background:'Site work',approach:'Report',amount:1000},'pm-b');const act=(actor,action,data)=>actBusiness(s,r.id,actor,action,data);act('pm-b','submit');act('jamie','approve');act('sam','approve');act('pm-b','source',{supplierSelectionVersion:1,quotes:[{supplier:'Preferred Co',priceMin:800,amount:1000,serviceScope:'Survey and report'},{supplier:'Alternative Co',priceMin:700,amount:alternative,serviceScope:'Survey and report'}],selectedIndex:0,reason:'Relevant experience'});act('jamie','approve');act('sam','approve');return {s,r,act};}
test('Preferred is not final: explicit choice is required before contract or AI work',()=>{
 const {s,r,act}=fixture();assert.equal(r.finalSupplier,null);assert.equal(r.preferredQuote,r.selectedQuote);
 assert.throws(()=>act('pm-b','contract',{files:[file],amount:900}),/Confirm the final supplier/);assert.throws(()=>contractRequest(s,'pm-b',r.id),/Confirm the final supplier/);
 assert.throws(()=>act('taylor','choose-supplier',{quoteId:r.selectedQuote}),/Only the requester/);
 assert.throws(()=>act('pm-b','choose-supplier',{quoteId:'unknown'}),/reviewed proposals/);
 act('pm-b','choose-supplier',{quoteId:r.selectedQuote});assert.equal(r.stage,'Contract preparation');assert.equal(r.finalSupplier.quoteId,r.selectedQuote);assert.equal(r.finalSupplier.actor,'pm-b');assert.equal(contractRequest(s,'pm-b',r.id),r);
 act('pm-b','contract',{files:[file],amount:900,submit:true});assert.equal(r.stage,'Contract review');
 assert.throws(()=>act('pm-b','choose-supplier',{quoteId:r.quotes[1].id,reason:'Changed'}),/contract preparation/);
});
test('Switching suppliers archives old evidence, clears approvals and requires both reviewers again',()=>{
 const {r,act}=fixture(),preferred=r.selectedQuote,other=r.quotes[1].id;
 act('pm-b','choose-supplier',{quoteId:preferred});act('pm-b','contract',{files:[file],amount:900,bankDetails:'Old supplier bank'});r.customerContracts={quoteId:preferred,files:[file]};
 assert.throws(()=>act('pm-b','choose-supplier',{quoteId:other}),/Explain/);
 act('pm-b','choose-supplier',{quoteId:other,reason:'Better delivery date'});assert.equal(r.stage,'Supplier review');assert.equal(r.preferredQuote,preferred);assert.equal(r.selectedQuote,other);assert.equal(r.finalSupplier,null);assert.equal(r.serviceContract,null);assert.equal(r.customerContracts,null);assert.equal(r.archives.at(-1).serviceContract.bankDetails,'Old supplier bank');assert.equal(r.archives.at(-1).customerContracts.quoteId,preferred);assert.deepEqual(r.gates['Supplier review'],{});
 assert.throws(()=>act('pm-b','contract',{files:[file],amount:900}));act('jamie','approve');assert.equal(r.stage,'Supplier review');act('sam','approve');assert.equal(r.stage,'Contract preparation');assert.equal(r.finalSupplier.quoteId,other);assert.equal(r.finalSupplier.reason,'Better delivery date');
 act('pm-b','contract',{files:[file],amount:800,submit:true});assert.equal(r.serviceContract.bankDetails,'');assert.equal(r.stage,'Contract review');
});
test('A final supplier over budget goes through budget approval and supplier approval',()=>{
 const {r,act}=fixture(1200);act('pm-b','choose-supplier',{quoteId:r.quotes[1].id,reason:'Capacity available'});assert.equal(r.stage,'Budget review');assert.equal(r.budgetChange,1200);
 act('jamie','approve');act('sam','approve');assert.equal(r.stage,'Supplier review');assert.equal(r.finalSupplier,null);act('sam','approve');act('jamie','approve');assert.equal(r.stage,'Contract preparation');assert.equal(r.approvedBudget,1200);assert.equal(r.finalSupplier.quoteId,r.quotes[1].id);
});
