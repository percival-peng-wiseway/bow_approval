import {saveProject,createBusinessRequest,actBusiness} from '../../app/business.mjs';
import {signing,bankVerification,invoiceData} from './service-v2.mjs';
export const evidence={name:'synthetic-evidence.txt',data:'data:text/plain;base64,VGVzdA==',size:4};
export function serviceFixture({requester='pm-b',signed=false,verified=false,invoiceFlow=false}={}){
 const s={},p=saveProject(s,{name:'Development test',pm:'taylor',director:'sam',payingEntity:'Test Development Pty Ltd',budget:30000},'alex');
 const r=createBusinessRequest(s,{kind:'service',projectId:p.id,title:'Site survey',background:'Prepare development',approach:'Certified report',amount:20000},requester);
 // Existing v2 fixtures retain their pre-invoice-gate route; invoice tests opt into the current gate.
 if(!invoiceFlow)delete r.invoiceFlowVersion;
 const act=(actor,action,data)=>actBusiness(s,r.id,actor,action,data);
 act(requester,'submit');act('sam','approve');act('director-b','approve');act('director-c','approve');act(requester==='jamie'?'alex':'jamie','approve');
 act(requester,'source',{quotes:[{supplier:'Test Surveyor',priceMin:18000,amount:20000,serviceScope:'Survey and report'}],selectedIndex:0,reason:'Relevant qualification',supplierSelectionVersion:1});
 act('sam','approve');act('director-b','approve');act('director-c','approve');act(requester==='jamie'?'alex':'jamie','approve');act(requester,'choose-supplier',{quoteId:r.selectedQuote});
 act(requester,'contract',{files:[evidence],amount:18000,submit:true});act(requester==='jamie'?'alex':'jamie','approve');
 if(signed)act(requester,'sign-contract',signing([evidence]));if(verified)act(requester==='jamie'?'alex':'jamie','verify-bank',bankVerification);
 return {s,p,r,act};
}
export const milestone=(amount,kind='Final',dueDate='2026-10-25')=>({kind,amount,label:kind,dueDate,method:'Bank transfer',requirements:'Invoice and milestone evidence'});
export const paymentEvidence=(invoiceNumber='TEST-INVOICE')=>({...invoiceData,invoiceNumber,files:[evidence],acceptanceSummary:'Work and defects inspected',acceptanceFiles:[evidence]});
export function finishPayment(f,reference){const {r,act}=f;act(r.requester,'documents',paymentEvidence(reference));act(r.requester==='taylor'?'sam':'taylor','approve',{note:'Inspected milestone / contractual advance basis'});if(['Final acceptance','Project Director sign-off'].includes(r.stage))act('sam','approve');act(r.requester==='jamie'?'alex':'jamie','approve');act(r.requester==='jamie'?'alex':'jamie','paid',{reference,date:'2026-10-25',files:[evidence]});}
