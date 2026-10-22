import test from 'node:test';
import assert from 'node:assert/strict';
import {users,initialState,canManageWorkflows,createWorkflow,workflowInfo,workflowOptions,createRequest,updateRequest,updateWorkflow,decide} from '../app/domain.mjs';
const data={type:'Bill',supplier:'Test',items:[{description:'Service',quantity:1,unitPrice:100,taxRate:0}]};
test('employee and nine management roles preserve legacy IDs and allow all requested approvers',()=>{
 assert.deepEqual(users.map(u=>u.name),['Employee','Kate','Lewis','Joe','Jason','Steve','Hassan Kassem','Nidhi Pandey','PM C','PM D']);
 assert.equal(users.filter(u=>u.role==='Director').length,3);assert.equal(users.filter(u=>u.role==='PM').length,4);
 assert.equal(users.find(u=>u.id==='alex').name,'Kate');assert.equal(users.find(u=>u.id==='jamie').name,'Lewis');assert.equal(users.find(u=>u.id==='sam').name,'Joe');assert.equal(users.find(u=>u.id==='taylor').name,'Hassan Kassem');
 for(const actor of users){const s=initialState();updateWorkflow(s,'Bill',[{id:'one',name:'Review',mode:'Any',approvers:[actor.id],minAmount:0}],'alex');const requester=actor.id==='taylor'?'pm-b':'taylor';const r=createRequest(s,data,requester);decide(s,r.id,actor.id,'approve');assert.equal(r.status,'Approved');}
});
test('new workflows have isolated graph copies and are selectable per request type',()=>{
 const s=initialState(),before=JSON.stringify(s.workflows.Bill);const copied=createWorkflow(s,{name:'Site expenses',type:'Bill',sourceId:'Bill'},'alex');
 assert.equal(workflowInfo(s,copied).type,'Bill');assert.equal(workflowOptions(s,'Bill').length,2);s.workflows[copied][0].approvers=['director-b'];assert.equal(JSON.stringify(s.workflows.Bill),before);
 const r=createRequest(s,{...data,workflowId:copied},'pm-c');assert.equal(r.workflowId,copied);assert.deepEqual(r.steps[0].approvers,['director-b']);
 const defaultRequest=createRequest(s,data,'pm-d');assert.deepEqual(defaultRequest.steps[0].approvers,['alex','jamie']);
 const length=s.requests.length;assert.throws(()=>createRequest(s,{...data,type:'Purchase Order',workflowId:copied},'taylor'),/request type/);assert.equal(s.requests.length,length);
 updateWorkflow(s,copied,[{id:'new',name:'Director C',mode:'Any',approvers:['director-c'],minAmount:0}],'jamie');assert.deepEqual(r.steps[0].approvers,['director-b']);
});
test('legacy requests without workflow ID still edit and submit; type change resets default',()=>{
 const s=initialState();const r=createRequest(s,data,'taylor',{draft:true});delete r.workflowId;
 updateRequest(s,r.id,{note:'Legacy draft'},'taylor');assert.equal(r.workflowId,'Bill');updateRequest(s,r.id,{type:'Purchase Order'},'taylor');assert.equal(r.workflowId,'Purchase Order');
 const before=JSON.stringify(r);assert.throws(()=>updateRequest(s,r.id,{workflowId:'missing'},'taylor'),/request type/);assert.equal(JSON.stringify(r),before);
});
test('workflow names, copy types and management permissions are validated before mutation',()=>{
 const s=initialState(),before=JSON.stringify(s.workflows);for(const args of [{name:'',type:'Bill'},{name:'Bill workflow',type:'Bill'},{name:'copy',type:'Bill',sourceId:'Purchase Order'}])assert.throws(()=>createWorkflow(s,args,'alex'));
 for(const u of users.filter(u=>u.role==='PM')){assert.equal(canManageWorkflows(u.id),false);assert.throws(()=>createWorkflow(s,{name:'Denied',type:'Bill'},u.id),/Only Admin/);}
 assert.equal(JSON.stringify(s.workflows),before);
 for(const id of ['alex','jamie','sam','director-b','director-c']){assert.equal(canManageWorkflows(id),true);createWorkflow(s,{name:'Workflow '+id,type:'Bill'},id);}
});
