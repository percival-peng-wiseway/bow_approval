import {randomUUID} from 'node:crypto';
import {cleanAbn,nameMatches} from './abn-check.mjs';
const need=(v,m)=>{if(!v)throw Object.assign(new Error(m),{status:400});};
export async function checkExpenseSupplier(input,actor,store){
 const abn=cleanAbn(input.abn),supplier=String(input.supplier||'').trim();
 need(/^\d{11}$/.test(abn),'Enter an 11-digit supplier ABN.');need(supplier&&supplier.length<=300,'Enter the supplier name.');
 const entry=await store.lookup(abn),match=nameMatches(supplier,entry.names||[]);
 const warnings=[];if(entry.source!=='official')warnings.push(entry.source==='invalid'?'Invalid ABN.':'Official lookup unavailable.');else{if(entry.status?.toLowerCase()!=='active')warnings.push('ABN is not active.');if(!match)warnings.push('Supplier name differs from the registered names.');if(entry.gstRegistered===false)warnings.push('Supplier is not GST registered. Review any GST charged.');}
 const result={id:randomUUID(),requestId:'expense-supplier',kind:'expense-supplier',actor,supplier,selectedAbn:abn,checkedAt:new Date().toISOString(),entries:[{...entry,nameMatch:match}],warnings,status:warnings.length?'review':'checked'};
 await store.save(result);return result;
}
export async function verifyExpenseSupplier(input,store){
 if(input.operation!=='request'||!input.data)return;
 const d=input.data;delete d.supplierAbnCheck;
 if(d.supplierCheckId){const check=await store.load(d.supplierCheckId);need(check?.kind==='expense-supplier'&&check.selectedAbn===cleanAbn(d.supplierAbn)&&check.supplier===String(d.supplier||'').trim(),'Supplier details changed. Check the ABN again.');d.supplierAbnCheck=check;}
 delete d.supplierCheckId;
}
