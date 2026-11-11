import {allowedActions} from './business.mjs';
import {matchesRequestDate} from './request-dates.mjs';
const primaryActions=new Set(['invoice','sign-contract','sign-variation','verify-bank','complete-service','acknowledge','submit','approve','source','contract','plan','documents','paid','lodge']);
export function needsAction(request,actor){
 return allowedActions(request,actor).some(action=>primaryActions.has(action)&&(action!=='lodge'||!request.customerCompletion));
}
export function filterWorkspaceRequests(requests,{actor,tab='all',project='',kind='',status='All',search='',range=null,projects=[]}={}){
 const needle=search.trim().toLowerCase();
 return requests.filter(r=>(tab!=='todo'||needsAction(r,actor))&&(tab!=='created'||r.requester===actor)
  &&(!project||(project==='company'?r.kind==='corporation':r.projectId===project))&&(!kind||r.kind===kind)
  &&(status==='All'||(status==='Active'?!['Completed','Cancelled'].includes(r.stage):r.stage===status))
  &&(!range||matchesRequestDate(r,range))
  &&(!needle||[r.title,r.reference,projects.find(p=>p.id===r.projectId)?.name].some(v=>String(v||'').toLowerCase().includes(needle))))
  .sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')));
}
export const paymentDueDate=p=>p.invoiceDueDate||p.dueDate||'';
export function scheduledPayments(requests){
 return requests.flatMap(request=>(request.payments||[]).map((payment,index)=>({request,payment,index})))
  .sort((a,b)=>(paymentDueDate(a.payment)||'9999').localeCompare(paymentDueDate(b.payment)||'9999'));
}
export function upcomingPayments(requests,actor,projects,today){
 const end=new Date(today+'T12:00:00Z');end.setUTCDate(end.getUTCDate()+7);const until=end.toISOString().slice(0,10);
 return scheduledPayments(requests).filter(({request:r,payment:p})=>{
  const project=projects.find(x=>x.id===r.projectId);
  return ['Pending','Review','Ready'].includes(p.status)&&paymentDueDate(p)&&paymentDueDate(p)<=until
   &&(r.requester===actor||actor==='jamie'||project?.pm===actor||project?.director===actor);
 });
}
