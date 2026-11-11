import test from 'node:test';
import assert from 'node:assert/strict';
import {approvalGraph,approvalKinds} from '../app/approval-v1.mjs';
import {saveProject,createBusinessRequest,actBusiness} from '../app/business.mjs';
const file={name:'receipt.txt',data:'data:text/plain;base64,ZXZpZGVuY2U=',size:8};
const edge=(g,from,to)=>g.edges.some(e=>e.from===from&&e.to===to);
test('Every v1 node is reachable and every connection has valid endpoints',()=>{
 for(const kind of Object.keys(approvalKinds))for(const threshold of [null,10000,20000]){
  const g=approvalGraph(kind,{name:'Example',pm:'taylor',director:'sam',threshold});
  const ids=new Set(g.nodes.map(n=>n.id));assert.equal(ids.size,g.nodes.length);
  for(const e of g.edges){assert.ok(ids.has(e.from));assert.ok(ids.has(e.to));}
  const reached=new Set(['submit']);let size;do{size=reached.size;for(const e of g.edges)if(reached.has(e.from))reached.add(e.to);}while(size!==reached.size);
  assert.equal(reached.size,ids.size,kind);assert.equal(g.version,kind==='service'?'v2':'v1');
 }
});
test('Reimbursement graph reflects PM review and nonblocking notices strictly above AUD 2000',()=>{
 for(const threshold of [null,10000,20000])for(const amount of [2000,2000.01,20000]){
  const s={},p=saveProject(s,{name:'A',pm:'taylor',director:'sam',threshold},'alex');
  const g=approvalGraph('reimbursement',p),r=createBusinessRequest(s,{kind:'reimbursement',projectId:p.id,invoiceDate:'2026-10-22',amount,attachments:[file]},'pm-b');
  actBusiness(s,r.id,'pm-b','submit');assert.equal(r.stage,'PM review');actBusiness(s,r.id,'taylor','approve');assert.equal(r.stage,'Finance review');assert.equal(!!r.directorNotice,amount>2000);
  assert.ok(edge(g,'submit','pm'));assert.ok(edge(g,'notice','finance'));assert.ok(!g.nodes.some(n=>n.id==='supervisor'||n.id==='director'));assert.equal(g.nodes.find(n=>n.id==='notice').type,'action');
 }
});
test('Service graph retains two approval gates, optional customer path and final acceptance loop',()=>{
 const g=approvalGraph('service',{name:'A',pm:'taylor',director:'director-b',threshold:10000});
 for(const [from,to] of [['notify','customer'],['notify','budget'],['over','increase'],['increase','supplier'],['final','acceptance'],['acceptance','payment-review'],['remaining','documents'],['remaining','completion-check']])assert.ok(edge(g,from,to));
 for(const id of ['budget','supplier'])assert.equal(g.nodes.find(n=>n.id===id).owner,'Lewis + Jason');
 assert.match(g.nodes.find(n=>n.id==='final').owner,/Payment type/);
 assert.match(g.nodes.find(n=>n.id==='increase').detail,/customer confirmation/);
});
test('Independent graph instances do not change the baseline or project configuration',()=>{
 const p={name:'A',pm:'taylor',director:'sam',threshold:10000},before=structuredClone(p);
 const a=approvalGraph('service',p);a.nodes[0].x=900;a.edges.pop();
 const b=approvalGraph('service',p);assert.notEqual(a.nodes[0].x,b.nodes[0].x);assert.equal(b.edges.length,a.edges.length+1);assert.deepEqual(p,before);
});

test('Company graph goes directly to dual review without supervisor nodes',()=>{const g=approvalGraph('corporation');assert.deepEqual(g.nodes.map(n=>n.id),['submit','review','paid','completed']);assert.ok(edge(g,'submit','review'));});
