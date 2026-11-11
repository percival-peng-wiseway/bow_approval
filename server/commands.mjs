import {assertCommandAccess} from './access.mjs';
import {reviewSnapshot,changedFields,saveNotificationSettings} from '../app/workspace-insights.mjs';
import {isAdmin,users} from '../app/domain.mjs';
import {saveSupplierProfile} from '../app/suppliers.mjs';
import {saveApprovalDesign,confirmApprovalDesign} from '../app/approval-design.mjs';
import {saveCustomerAccess,saveCustomer,customerDecision,shareCustomerContracts} from '../app/customer-domain.mjs';
import {saveProject,createBusinessRequest,updateBusinessRequest,actBusiness} from '../app/business.mjs';
function runCommand(state,actor,input){
 if(input.operation==='notification-settings')return saveNotificationSettings(state,actor,input);
 if(input.operation==='supplier-profile')return saveSupplierProfile(state,actor,input);
 if(input.operation==='approval-design-confirm')return confirmApprovalDesign(state,actor,input);
 if(input.operation==='approval-design')return saveApprovalDesign(state,actor,input);
 if(input.operation==='share-contracts')return shareCustomerContracts(state,actor,input);
 if(input.operation==='project-customer'){
  if(!isAdmin(actor))throw Object.assign(new Error('Only Admin can invite project customers.'),{status:403});
  const p=state.business.projects.find(p=>p.id===input.projectId&&p.active);if(!p)throw new Error('Choose an active project.');
  const email=String(input.data?.email||'').trim().toLowerCase(),existing=state.business.customers?.find(c=>c.email===email);
  if(existing&&!existing.active)throw new Error('Reactivate this customer account before inviting it.');
  const c=existing||saveCustomer(state,input.data,actor);
  const project=saveProject(state,{...p,customerId:c.id},actor);project.customerAccessEstablished=true;
  return {customer:c,project};
 }
 if(input.operation==='customer-access')return saveCustomerAccess(state,actor,input);
 if(input.operation==='customer')return saveCustomer(state,input.data,actor);
 if(input.operation==='customer-decision')return customerDecision(state,actor,input);
 if(input.operation==='project'){
  if(!users.some(u=>u.id===input.data?.pm&&u.role==='PM'&&!u.inactive)||!users.some(u=>u.id===input.data?.director&&u.role==='Director'&&!u.inactive))throw new Error('Choose an active PM and Director.');
  return saveProject(state,input.data,actor);
 }
 if(input.operation==='request'){
  const result=input.id?updateBusinessRequest(state,input.id,input.data,actor):createBusinessRequest(state,input.data,actor);
  if(input.submit)actBusiness(state,result.id,actor,'submit');return result;
 }
 if(input.operation==='action')return actBusiness(state,input.id,actor,input.action,input.data);
 throw new Error('Unknown operation.');
}

export function applyCommand(state,actor,input){
 assertCommandAccess(state,actor,input);
 const request=state.business?.requests?.find(r=>r.id===input.id);
 const baseline=request?reviewSnapshot(request):null,fromStage=request?.stage;
 const result=runCommand(state,actor,input);
 if(request&&(input.operation==='action'&&input.action==='return'&&!['Variation review','Invoice review'].includes(fromStage)||input.operation==='customer-decision'&&input.decision!=='approve')){
  request.changeRequests??=[];
  request.changeRequests.push({id:crypto.randomUUID(),at:new Date().toISOString(),by:actor,assignedTo:request.requester,fromStage,reason:String(input.data?.reason||input.comment||''),baseline,status:'open'});
 }
 if(request&&((input.operation==='request'&&input.submit)||(input.operation==='action'&&['submit','source','contract','documents','variation','complete-service'].includes(input.action)))){
  const cycle=request.changeRequests?.findLast(c=>c.status==='open');
  if(cycle&&!['Draft','Returned','Customer changes','Contract preparation','Sourcing','Payment documents','Withdrawn'].includes(request.stage)){
   cycle.status='resubmitted';cycle.resubmittedAt=new Date().toISOString();cycle.changes=changedFields(cycle.baseline,reviewSnapshot(request));delete cycle.baseline;
  }
 }
 return result;
}
