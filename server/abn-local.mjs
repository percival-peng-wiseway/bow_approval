import fs from 'node:fs/promises';
import path from 'node:path';
import {createContractCheck,lookupAbn,verifySourceChecks} from './abn-check.mjs';
import {scanInvoice} from '../ocr/service.mjs';
import {allowedActions} from '../app/business.mjs';
export async function localCheckStore(dir){
 const folder=path.join(dir,'abn-checks');await fs.mkdir(folder,{recursive:true,mode:0o700});let guid=process.env.ABN_LOOKUP_GUID;
 if(!guid)try{guid=(await fs.readFile(path.join(dir,'abn-lookup-guid'),'utf8')).trim();}catch{}
 return {configured:!!guid,scan:scanInvoice,lookup:abn=>lookupAbn(abn,guid),save:result=>fs.writeFile(path.join(folder,result.id+'.json'),JSON.stringify(result),{mode:0o600}),load:async id=>{if(!/^[a-f0-9-]{36}$/.test(id))return null;try{return JSON.parse(await fs.readFile(path.join(folder,id+'.json'),'utf8'));}catch{return null;}}};
}
export async function checkLocalContract(workspace,store,actor,input){const r=workspace.read(actor).state.business.requests.find(r=>r.id===input.requestId);if(!r||!allowedActions(r,actor).includes('contract'))throw Object.assign(new Error('Only the requester can check the contract after supplier approval.'),{status:403});const q=r.quotes.find(q=>q.id===r.selectedQuote);return createContractCheck({...input,documentType:'contract',supplier:q.supplier},actor,store);}
export {verifySourceChecks};

export async function checkLocalInvoice(workspace,store,actor,input){const r=workspace.read(actor).state.business.requests.find(r=>r.id===input.requestId);if(!r||!allowedActions(r,actor).includes('invoice'))throw Object.assign(new Error('Only the requester can check invoices after contract signing.'),{status:403});const q=r.quotes.find(q=>q.id===r.selectedQuote);return createContractCheck({...input,supplier:q.supplier,documentType:'invoice'},actor,store);}
