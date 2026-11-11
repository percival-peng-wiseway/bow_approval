import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {initialDesign,normalizeDesign,designWarnings,saveApprovalDesign} from '../app/approval-design.mjs';
import {approvalGraph} from '../app/approval-v1.mjs';
import {openWorkspace} from '../server/workspace.mjs';
import {saveProject,createBusinessRequest,actBusiness} from '../app/business.mjs';
const project={id:'project-a',name:'A',pm:'taylor',director:'sam',threshold:20000};
test('all three current workflows become editable drafts with the same topology',()=>{
 for(const kind of ['corporation','reimbursement','service']){
  const initial=initialDesign(kind,project),g=normalizeDesign(initial),baseline=approvalGraph(kind,project);
  assert.equal(g.name,kind==='service'?'Service v2':'v1');assert.equal(g.nodes.length,baseline.nodes.length);assert.equal(g.edges.length,baseline.edges.length);
  assert.deepEqual(g.edges.map(({from,to,label})=>({from,to,label})),baseline.edges.map(({from,to,label})=>({from,to,label})));
  assert.deepEqual(designWarnings(g),[]);
 }
});
test('draft supports additional approvals, conditions and branches without mutating baseline',()=>{
 const g=initialDesign('corporation');g.nodes.push({id:'extra',title:'Extra review',type:'approval',participants:['sam'],mode:'All',x:500,y:500});
 assert.ok(designWarnings(normalizeDesign(g)).some(w=>w.includes('not connected')));
 g.edges.push({id:'extra-route',from:'review',to:'extra',label:'Needs review'});
 g.edges.push({id:'extra-end',from:'extra',to:'paid',label:'Approved'});
 assert.deepEqual(designWarnings(normalizeDesign(g)),[]);
 assert.ok(!initialDesign('corporation').nodes.some(n=>n.id==='extra'));
});
test('invalid references, duplicate connections and unknown participants cannot be saved',()=>{
 const g=initialDesign('corporation');
 for(const alter of [g=>g.edges.push({id:'bad',from:'missing',to:'paid'}),g=>g.edges.push({...g.edges[0],id:'dup'}),g=>g.nodes[0].participants=['outsider'],g=>g.edges[0].to=g.edges[0].from]){
  const candidate=structuredClone(g);alter(candidate);assert.throws(()=>normalizeDesign(candidate));
 }
});
test('saving a draft enforces roles and per-design revision; existing approvals are unchanged',()=>{
 const state={business:{projects:[project],requests:[{id:'request-a',stage:'Finance review',route:{director:'sam'}}]}},before=structuredClone(state);
 const input={graph:initialDesign('reimbursement',project),projectId:project.id,expectedVersion:0};
 assert.throws(()=>saveApprovalDesign(state,'taylor',input),e=>e.status===403);assert.deepEqual(state,before);
 const result=saveApprovalDesign(state,'alex',input);assert.equal(result.status,'draft');assert.equal(result.revision,1);
 assert.deepEqual(state.business.requests,before.business.requests);assert.deepEqual(state.business.projects,before.business.projects);
 assert.throws(()=>saveApprovalDesign(state,'director-c',input),e=>e.status===409);
 const second=saveApprovalDesign(state,'director-c',{...input,expectedVersion:1});assert.equal(second.revision,2);
});
test('draft does not affect new reimbursement routing',()=>{
 const s={},p=saveProject(s,{name:'A',pm:'taylor',director:'sam',threshold:20000},'alex');
 const graph=initialDesign('reimbursement',p);graph.nodes.find(n=>n.id==='threshold').condition.value='1';
 saveApprovalDesign(s,'alex',{graph,projectId:p.id,expectedVersion:0});
 const r=createBusinessRequest(s,{kind:'reimbursement',projectId:p.id,amount:100,invoiceDate:'2026-11-02',attachments:[{name:'receipt.txt',data:'data:text/plain;base64,QQ==',size:1}]},'pm-b');
 actBusiness(s,r.id,'pm-b','submit');actBusiness(s,r.id,'taylor','approve');assert.equal(r.stage,'Finance review');assert.equal(r.route.noticeThreshold,2000);
});
test('shared workspace saves drafts across reopen and rejects stale concurrent writes',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bow-flow-test-'));
 try{
  const workspace=await openWorkspace(dir),input={operation:'approval-design',graph:initialDesign('corporation'),projectId:'',expectedVersion:0,revision:0};
  const saved=await workspace.command('alex',input);assert.equal(saved.revision,1);
  await assert.rejects(workspace.command('jamie',input),e=>e.status===409);
  const reopened=await openWorkspace(dir);assert.deepEqual(reopened.read('jamie').state.business.workflowDesigns[0].graph,saved.result.graph);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('independent designs preserve v1, scope, revisions and confirmations',async()=>{
 const {confirmApprovalDesign,designsForScope}=await import('../app/approval-design.mjs');
 const state={business:{projects:[project],requests:[]}},graph=initialDesign('corporation');
 const base=saveApprovalDesign(state,'alex',{graph,expectedVersion:0});
 const a=saveApprovalDesign(state,'alex',{graph:{...graph,name:'Alternative A'},designId:'alternative-a',expectedVersion:0});
 const b=saveApprovalDesign(state,'alex',{graph:{...graph,name:'Alternative B'},designId:'alternative-b',expectedVersion:0});
 assert.equal(designsForScope(state,'corporation').length,3);
 assert.equal(designsForScope(state,'service',project.id).length,0);
 confirmApprovalDesign(state,'alex',{key:a.key,expectedVersion:1});
 assert.equal(state.business.workflowDesigns.find(d=>d.key===a.key).status,'confirmed');
 assert.equal(state.business.workflowDesigns.find(d=>d.key===b.key).status,'draft');
 const updated=saveApprovalDesign(state,'alex',{graph:{...graph,name:'Alternative A updated'},designId:'alternative-a',expectedVersion:1});
 assert.equal(updated.revision,2);assert.equal(updated.versions[0].status,'confirmed');
 assert.deepEqual(state.business.workflowDesigns.find(d=>d.key===base.key),base);
 assert.throws(()=>saveApprovalDesign(state,'alex',{graph,designId:'alternative-a',expectedVersion:1}),e=>e.status===409);
 assert.throws(()=>saveApprovalDesign(state,'alex',{graph,designId:'bad:id',expectedVersion:0}),/identifier/);
});
test('multiple designs survive workspace reopen independently',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bow-design-library-'));
 try{const workspace=await openWorkspace(dir);let revision=0;
 for(const id of ['a','b']){const saved=await workspace.command('alex',{operation:'approval-design',graph:{...initialDesign('corporation'),name:id},designId:id,expectedVersion:0,revision});revision=saved.revision;}
 const reopened=await openWorkspace(dir);assert.deepEqual(reopened.read('alex').state.business.workflowDesigns.map(d=>d.graph.name),['a','b']);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('sandbox previews conditions without changing drafts or live requests',async()=>{
 const {previewDesign,evaluateDesignCondition}=await import('../app/approval-test.mjs');
 const graph=initialDesign('reimbursement',project),before=structuredClone(graph);
 const low=previewDesign(graph,{requesterRole:'Employee',amount:2000});assert.ok(!low.steps.some(n=>n.id==='notice'));assert.equal(low.message,'Preview complete.');
 const high=previewDesign(graph,{requesterRole:'Employee',amount:2000.01});assert.ok(high.steps.some(n=>n.id==='notice'));assert.equal(high.message,'Preview complete.');
 const fork=structuredClone(graph);fork.edges.push({id:'manual-route',from:'pm',to:'paid',label:'Test alternate'});const manual=previewDesign(fork,{amount:100});assert.equal(manual.nodeId,'pm');assert.equal(manual.choices.length,2);
 const resolved=previewDesign(fork,{amount:100},{pm:manual.choices[0].id});assert.equal(resolved.message,'Preview complete.');
 assert.deepEqual(graph,before);assert.equal(evaluateDesignCondition({field:'custom',operator:'eq',value:'yes'},{}),null);
 const service=initialDesign('service',project),loop=previewDesign(service,{notifyCustomer:false,aboveBudget:false,finalPayment:false,hasMorePayments:true},{change:service.edges.find(e=>e.from==='change'&&e.to==='bank').id});assert.match(loop.message,/Loop/);
 const end=previewDesign(service,{notifyCustomer:true,aboveBudget:true,finalPayment:true,hasMorePayments:false},{change:service.edges.find(e=>e.from==='change'&&e.to==='bank').id,'completion-check':service.edges.find(e=>e.from==='completion-check'&&e.to==='completed').id});assert.ok(end.steps.some(n=>n.id==='customer'));assert.ok(end.steps.some(n=>n.id==='acceptance'));assert.equal(end.message,'Preview complete.');
});
