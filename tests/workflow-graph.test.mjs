import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,updateWorkflow,createRequest,decide,submit,matchesStep} from '../app/domain.mjs';
import {normalizeWorkflow,traceGraph,validateGraph} from '../app/workflow-graph.mjs';
const approval=(id,approvers,next='end')=>({id,kind:'approval',name:id,mode:'Any',approvers,minAmount:0,maxAmount:null,departments:[],next});
const branch=()=>({id:'amount',kind:'condition',name:'Amount',minAmount:10000,maxAmount:null,departments:[],yes:'cfo',no:'manager'});
const graph=()=>[branch(),approval('manager',['alex'],'finance'),approval('cfo',['sam'],'finance'),approval('finance',['jamie'])];
const data=(amount,department='Operations')=>({type:'Bill',supplier:'Test',department,items:[{description:'Service',quantity:1,unitPrice:amount,taxRate:0}]});
test('branches choose mutually exclusive routes, converge and enforce approval order',()=>{
 const state=initialState();updateWorkflow(state,'Bill',graph(),'alex');
 const low=createRequest(state,data(9999.99),'taylor');const high=createRequest(state,data(10000),'taylor');
 assert.deepEqual(low.steps.map(n=>n.id),['manager','finance']);assert.deepEqual(high.steps.map(n=>n.id),['cfo','finance']);
 assert.throws(()=>decide(state,high.id,'alex','approve'),/not eligible/);assert.throws(()=>decide(state,high.id,'jamie','approve'),/not eligible/);
 decide(state,high.id,'sam','approve');assert.equal(high.status,'On approval');decide(state,high.id,'jamie','approve');assert.equal(high.status,'Approved');
});
test('condition combines inclusive lower, exclusive upper and department; GST total decides branch',()=>{
 const state=initialState(),g=graph();g[0].minAmount=5000;g[0].maxAmount=10000;g[0].departments=['Operations','Technology'];updateWorkflow(state,'Bill',g,'sam');
 for(const [amount,dept,expected]of [[4999.99,'Operations','manager'],[5000,'Operations','cfo'],[9999.99,'Technology','cfo'],[10000,'Operations','manager'],[7000,'Marketing','manager']])assert.equal(createRequest(state,data(amount,dept),'taylor').steps[0].id,expected);
 const taxable=data(9500);taxable.items[0].taxRate=10;assert.equal(createRequest(state,taxable,'taylor').steps[0].id,'manager');
});
test('invalid graphs and ranges are rejected atomically',()=>{
 const state=initialState(),before=JSON.stringify(state.workflows);
 for(const alter of [g=>g[0].yes='missing',g=>g[1].next='amount',g=>g.push(approval('orphan',['alex'])),g=>g[0].maxAmount=9000,g=>g[0].minAmount=-1,g=>g[0].departments=['Operations','Operations'],g=>g[1].approvers=[],g=>g[1].kind='mystery']){const g=graph();alter(g);assert.throws(()=>updateWorkflow(state,'Bill',g,'alex'));assert.equal(JSON.stringify(state.workflows),before);}
});
test('empty approval route blocks submission without adding request; self approval remains blocked',()=>{
 const state=initialState(),g=graph();g[0].no='end';g.splice(1,1);updateWorkflow(state,'Bill',g,'alex');const count=state.requests.length;
 assert.throws(()=>createRequest(state,data(50),'taylor'),/No approval rule/);assert.equal(state.requests.length,count);
 assert.throws(()=>createRequest(state,data(15000),'sam'),/self-approval/);assert.equal(state.requests.length,count);
});
test('workflow edits preserve submitted branch and rejected resubmission uses new graph',()=>{
 const state=initialState();updateWorkflow(state,'Bill',graph(),'alex');const old=createRequest(state,data(5000),'taylor');
 const changed=graph();changed[0].minAmount=1000;updateWorkflow(state,'Bill',changed,'alex');assert.deepEqual(old.steps.map(n=>n.id),['manager','finance']);
 decide(state,old.id,'alex','reject','Change request');submit(state,old.id,'taylor');assert.deepEqual(old.steps.map(n=>n.id),['cfo','finance']);
});
test('legacy workflow migration is detached and preserves thresholds and routing',()=>{
 const state=initialState(),legacy=state.workflows.Bill,before=JSON.stringify(legacy);const migrated=normalizeWorkflow(legacy);
 assert.equal(migrated[0].next,legacy[1].id);assert.equal(migrated[1].next,'end');assert.equal(JSON.stringify(legacy),before);
 assert.deepEqual(traceGraph(migrated,4400,'Operations',matchesStep).approvals.map(n=>n.name),['Department approval']);
 assert.equal(traceGraph(migrated,10000,'Operations',matchesStep).approvals.length,2);
});
test('layout persistence is independent of execution and bills/PO workflows stay separate',()=>{
 const state=initialState(),g=graph(),po=JSON.stringify(state.workflows['Purchase Order']);g[0].position={x:900,y:600};g[1].position={x:150,y:20};updateWorkflow(state,'Bill',g,'sam');
 assert.deepEqual(state.workflows.Bill[0].position,{x:900,y:600});assert.equal(JSON.stringify(state.workflows['Purchase Order']),po);assert.equal(createRequest(state,data(15000),'taylor').steps[0].id,'cfo');
 assert.throws(()=>updateWorkflow(state,'Bill',g,'taylor'),/Admin, Finance or Directors/);
});
