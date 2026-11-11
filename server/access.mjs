import {users} from '../app/domain.mjs';
import {assignees} from '../app/business.mjs';
const role=id=>users.find(u=>u.id===id&&!u.inactive)?.role;
export const broadAccess=id=>['Admin','Finance'].includes(role(id));
export function canReadRequest(state,id,r){
 if(broadAccess(id))return true;
 if(!role(id))return false;
 const p=state.business?.projects?.find(p=>p.id===r.projectId);
 return r.requester===id||r.createdBy===id||r.supervisor===id||r.route?.supervisor===id||assignees(r).includes(id)||
 (r.kind!=='corporation'&&['pm','director','projectDirector'].some(k=>r.route?.[k]===id))||p?.pm===id||p?.director===id||
 Object.values(r.gates||{}).some(g=>Object.values(g||{}).some(v=>v?.by===id))||
 (r.history||[]).some(e=>e.actor===id);
}
export function canReadProject(state,id,p){return broadAccess(id)||p.pm===id||p.director===id||(p.members||[]).includes(id)||(state.business?.requests||[]).some(r=>r.projectId===p.id&&canReadRequest(state,id,r));}
export function visibleRecord(record,id){
 const out=structuredClone(record),s=out.state;s.actor=id;
 if(broadAccess(id))return out;
 s.business??={};s.business.requests=(s.business.requests||[]).filter(r=>canReadRequest(record.state,id,r));
 s.business.projects=(s.business.projects||[]).filter(p=>canReadProject(record.state,id,p)).map(p=>{const copy={...p};delete copy.customerAccess;delete copy.customerAccessHistory;return copy;});
 s.business.customers=role(id)==='Employee'?[]:(s.business.customers||[]).filter(c=>s.business.projects.some(p=>p.customerId===c.id)).map(c=>({id:c.id,name:c.name,active:c.active}));s.business.suppliers=[];
 s.requests=(s.requests||[]).filter(r=>r.requester===id||r.createdBy===id||(r.steps||[]).some(v=>(v.approvers||[]).includes(id)));
 delete s.adminActions;if(s.notificationSettings)s.notificationSettings={[id]:s.notificationSettings[id]};delete s.approvalDesigns;
 out.canImport=false;return out;
}
export function assertCommandAccess(state,id,input){
 if(input.operation==='customer-decision'||broadAccess(id))return;
 const deny=()=>{throw Object.assign(new Error('You do not have access to this request or project.'),{status:403});};
 if(!role(id))deny();
 if(['action','request','share-contracts'].includes(input.operation)&&input.id){const r=state.business?.requests?.find(r=>r.id===input.id);if(!r||!canReadRequest(state,id,r))deny();}
 if(input.operation==='request'&&!input.id&&input.data?.projectId){const p=state.business?.projects?.find(p=>p.id===input.data.projectId);if(!p||!canReadProject(state,id,p))deny();}
 if(input.operation==='project'&&input.data?.id){const p=state.business?.projects?.find(p=>p.id===input.data.id);if(!p||!canReadProject(state,id,p))deny();}
}
export function referencedFiles(value,found=new Set()){
 if(!value||typeof value!=='object')return found;
 if(typeof value.data==='string'&&value.data.startsWith('/api/files/'))found.add(value.data);
 for(const v of Object.values(value))referencedFiles(v,found);return found;
}
export function canReadFile(record,id,file){return referencedFiles(visibleRecord(record,id).state).has('/api/files/'+file);}
