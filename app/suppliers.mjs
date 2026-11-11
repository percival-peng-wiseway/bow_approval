import {isServiceV2,serviceTotal} from './service-controls.mjs';
import {users} from './domain.mjs';
import {paymentTotals} from './oa-ledger.mjs';
const clean=v=>String(v||'').trim();
const cents=v=>Math.round((Number(v)||0)*100);
export function supplierAbn(quote){const n=clean(quote?.supplierAbn||quote?.abnCheck?.selectedAbn).replace(/\D/g,'');return /^\d{11}$/.test(n)&&[10,1,3,5,7,9,11,13,15,17,19].reduce((s,w,i)=>s+(Number(n[i])-(i===0?1:0))*w,0)%89===0?n:'';}
export function supplierKey(request,quote){const abn=supplierAbn(quote);return abn?'abn:'+abn:'selection:'+request.id+':'+quote.id;}
export const canManageSuppliers=actor=>['Admin','Finance'].includes(users.find(u=>u.id===actor)?.role);
// Selection is a relationship, not proof that a supplier or contract was approved.
export function recordSupplierSelection(state,request,quote,actor){
 const list=state.business.suppliers??=[],id=supplierKey(request,quote);
 let entry=list.find(s=>s.id===id);
 if(!entry){entry={id,name:quote.supplier,abn:supplierAbn(quote),contact:'',email:'',phone:'',paymentTerms:'',notes:'',selections:[],history:[]};list.push(entry);}
 // When the PM records an ABN, carry forward the original selection profile.
 if(entry.abn){for(const old of [...list]){if(old===entry||old.abn)continue;const matches=(old.selections||[]).filter(x=>x.requestId===request.id&&x.quoteId===quote.id);if(!matches.length)continue;entry.selections??=[];entry.selections.push(...matches.filter(x=>!entry.selections.some(y=>y.requestId===x.requestId&&y.quoteId===x.quoteId)));for(const key of ['contact','email','phone','paymentTerms','notes'])if(!entry[key]&&old[key])entry[key]=old[key];entry.history=[...(entry.history||[]),...(old.history||[])];old.selections=old.selections.filter(x=>!matches.includes(x));if(!old.selections.length)list.splice(list.indexOf(old),1);}}
 const selections=entry.selections??=[];
 if(!selections.some(x=>x.requestId===request.id&&x.quoteId===quote.id))selections.push({requestId:request.id,quoteId:quote.id,projectId:request.projectId,supplier:quote.supplier,selectedAt:new Date().toISOString(),actor,abnCheck:quote.abnCheck?structuredClone(quote.abnCheck):null});
 return entry;
}
export function supplierRegister(state){
 const b=state.business||{},groups=new Map();
 for(const saved of b.suppliers||[])groups.set(saved.id,{...structuredClone(saved),engagements:[],projects:[],payments:[],paid:0,outstanding:0,selectedValue:0,checks:[]});
 for(const r of b.requests||[]){if(r.kind!=='service')continue;const q=r.quotes?.find(q=>q.id===r.selectedQuote);if(!q)continue;
  const id=supplierKey(r,q);let s=groups.get(id);
  if(!s){s={id,name:q.supplier,abn:supplierAbn(q),contact:'',email:'',phone:'',paymentTerms:'',notes:'',selections:[],history:[],engagements:[],projects:[],payments:[],paid:0,outstanding:0,selectedValue:0,checks:[]};groups.set(id,s);}
  const project=(b.projects||[]).find(p=>p.id===r.projectId),totals=paymentTotals(r);
  s.engagements.push({request:r,quote:q,project});s.projects.push(project?.id||r.projectId);if(q.abnCheck)s.checks.push(q.abnCheck);
  s.paid+=cents(totals.paid);s.outstanding+=cents(totals.outstanding);if(!['Cancelled','Withdrawn','Draft'].includes(r.stage))s.selectedValue+=cents(isServiceV2(r)&&r.serviceContract?serviceTotal(r):q.amount);
  for(const payment of r.payments||[])s.payments.push({payment,request:r,project});
 }
 for(const s of groups.values()){
  for(const selection of s.selections||[]){if(selection.abnCheck)s.checks.push(selection.abnCheck);if(selection.projectId)s.projects.push(selection.projectId);}
  s.projects=[...new Set(s.projects.filter(Boolean))];s.paid/=100;s.outstanding/=100;s.selectedValue/=100;
  s.checks.sort((a,b)=>String(b.checkedAt||'').localeCompare(String(a.checkedAt||'')));s.latestCheck=s.checks[0]||null;
  s.abnStatus=!s.latestCheck?'Not checked':s.latestCheck.status==='checked'?'Checked':'Needs review';
 }
 return [...groups.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
export function saveSupplierProfile(state,actor,input){
 if(!canManageSuppliers(actor))throw new Error('Only Admin and Finance can edit supplier details.');
 const current=supplierRegister(state).find(s=>s.id===input.id);if(!current)throw new Error('Choose a supplier selected on a service request.');
 const d=input.data||{},fields={};for(const [key,max] of [['contact',160],['email',160],['phone',60],['paymentTerms',500],['notes',3000]]){fields[key]=clean(d[key]);if(fields[key].length>max)throw new Error(key+' is too long.');}
 if(fields.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email))throw new Error('Enter a valid contact email.');
 const list=state.business.suppliers??=[];let saved=list.find(s=>s.id===input.id);
 if(!saved){saved={id:current.id,name:current.name,abn:current.abn,selections:[],history:[]};list.push(saved);}
 for(const e of current.engagements)recordSupplierSelection(state,e.request,e.quote,actor);
 Object.assign(saved,fields);saved.history??=[];saved.history.push({at:new Date().toISOString(),actor,action:'Supplier details updated'});return saved;
}
