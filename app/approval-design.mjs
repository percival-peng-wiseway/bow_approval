import {users,canManageWorkflows} from './domain.mjs';
import {approvalGraph,approvalKinds} from './approval-v1.mjs';
const currentParticipants=()=>[['applicant','Applicant'],['supervisor','Selected supervisor'],['project-pm','Project PM'],['project-director','Project Director'],['customer','Project customer'],...users.filter(u=>!u.inactive).map(u=>[u.id,u.name])];
export const participantOptions=new Proxy([], {get(_target,key){const values=currentParticipants(),v=Reflect.get(values,key);return typeof v==='function'?v.bind(values):v;}});
export const conditionFields=[['amount','Request amount · AUD'],['notifyCustomer','Notify customer'],['requesterRole','Applicant role'],['aboveBudget','Above approved budget'],['finalPayment','Final instalment'],['hasMorePayments','More instalments'],['custom','Custom condition']];
export const conditionOperators=[['gte','≥'],['gt','>'],['lte','≤'],['lt','<'],['eq','Equals'],['neq','Does not equal']];
export function designKey(kind,projectId='',designId=''){return `${kind}:${kind==='corporation'?'company':projectId||'default'}${designId?':'+designId:''}`;}
export function designsForScope(state,kind,projectId=''){const base=designKey(kind,projectId);return (state.business?.workflowDesigns||[]).filter(d=>d.key===base||d.key.startsWith(base+':'));}
export function initialDesign(kind,project){
 const g=approvalGraph(kind,project),people={submit:['applicant'],supervisor:['supervisor'],review:['alex','jamie'],pm:['project-pm'],notice:['project-director'],director:['project-director'],finance:['jamie'],paid:['jamie'],customer:['customer'],budget:['jamie','project-director'],sourcing:['applicant'],increase:['jamie','project-director'],supplier:['jamie','project-director'],contract:['applicant'],'contract-review':['jamie'],plan:['jamie'],documents:['applicant'],acceptance:['project-director'],'payment-review':['jamie'],lodge:['project-pm'],signing:['applicant'],invoice:['applicant'],'invoice-review':['jamie'],variation:['jamie','project-director'],'variation-sign':['applicant'],bank:['jamie'],delivery:['project-pm'],'completion-docs':['applicant'],'completion-pm':['project-pm'],'completion-director':['project-director']};
 const actionIds=['invoice','signing','variation-sign','bank','completion-docs','notice','paid','sourcing','contract','plan','documents','lodge'];
 const conditions={change:{field:'custom',operator:'eq',value:'Variation requested'},'completion-check':{field:'custom',operator:'eq',value:'Completion accepted'},employee:{field:'requesterRole',operator:'eq',value:'Employee'},threshold:{field:'amount',operator:'gt',value:'2000'},notify:{field:'notifyCustomer',operator:'eq',value:'true'},over:{field:'aboveBudget',operator:'eq',value:'true'},final:{field:'finalPayment',operator:'eq',value:'true'},remaining:{field:'hasMorePayments',operator:'eq',value:'true'}};
 return {...g,name:kind==='service'?'Service v2':'v1',nodes:g.nodes.map(n=>({...n,type:n.id==='lodge'?'end':n.type==='step'?(actionIds.includes(n.id)?'action':'approval'):n.type,participants:people[n.id]||[],mode:['review','budget','increase','supplier','variation'].includes(n.id)?'All':'Any',condition:conditions[n.id]||{field:'custom',operator:'eq',value:''}})),edges:g.edges.map((e,i)=>({...e,id:`edge-${i}`}))};
}
export function normalizeDesign(raw){
 const fail=m=>{throw new Error(m);};
 if(!raw||!Object.hasOwn(approvalKinds,raw.kind)||!Array.isArray(raw.nodes)||!Array.isArray(raw.edges))fail('Invalid workflow design.');
 if(!raw.nodes.length||raw.nodes.length>100||raw.edges.length>250)fail('Use 1–100 nodes and at most 250 connections.');
 const text=(s,max=3000)=>String(s??'').trim().slice(0,max),id=s=>{if(typeof s!=='string'||!/^[a-zA-Z0-9_-]{1,90}$/.test(s))fail('Invalid node or connection identifier.');return s;};
 const nodeIds=new Set(),edgeIds=new Set(),participants=new Set(participantOptions.map(([k])=>k));
 const nodes=raw.nodes.map(n=>{const key=id(n.id);if(nodeIds.has(key))fail('Duplicate node identifier.');nodeIds.add(key);if(!['start','end','approval','action','condition'].includes(n.type))fail('Choose a valid node type.');
  const p=Array.isArray(n.participants)?[...new Set(n.participants)]:[];if(p.some(x=>!participants.has(x)))fail('Choose a valid participant.');
  const condition=n.condition||{};if(condition.field&&!conditionFields.some(([k])=>k===condition.field)||condition.operator&&!conditionOperators.some(([k])=>k===condition.operator))fail('Invalid condition field or operator.');
  return {id:key,title:text(n.title,100),detail:text(n.detail),owner:text(n.owner,200),type:n.type,x:Math.max(32,Math.min(4000,Number(n.x)||32)),y:Math.max(32,Math.min(18000,Number(n.y)||32)),participants:p,mode:n.mode==='All'?'All':'Any',condition:{field:condition.field||'custom',operator:condition.operator||'eq',value:text(condition.value,500)}};
 });
 const pairs=new Set();const edges=raw.edges.map(e=>{const key=id(e.id);if(edgeIds.has(key))fail('Duplicate connection identifier.');edgeIds.add(key);if(!nodeIds.has(e.from)||!nodeIds.has(e.to))fail('A connection refers to a missing node.');if(e.from===e.to)fail('Connect two different nodes.');const label=text(e.label,100),pair=JSON.stringify([e.from,e.to,label]);if(pairs.has(pair))fail('This connection already exists.');pairs.add(pair);return {id:key,from:e.from,to:e.to,label,side:['left','right'].includes(e.side)?e.side:''};});
 return {name:text(raw.name,80)||'v1',version:'v1',kind:raw.kind,nodes,edges};
}
export function designWarnings(graph){
 const warnings=[],starts=graph.nodes.filter(n=>n.type==='start');
 if(starts.length!==1)warnings.push('Use exactly one start node.');
 if(!graph.nodes.some(n=>n.type==='end'))warnings.push('Add a completion node.');
 const reached=new Set(starts.map(n=>n.id));let count;do{count=reached.size;graph.edges.forEach(e=>{if(reached.has(e.from))reached.add(e.to);});}while(count!==reached.size);
 for(const n of graph.nodes){
  if(!n.title)warnings.push('Name every node.');
  if(!reached.has(n.id))warnings.push(`${n.title||'Unnamed node'} is not connected to the start.`);
  if(n.type==='approval'&&!n.participants.length)warnings.push(`${n.title}: choose approvers.`);
  if(n.type==='condition'&&(!n.condition.value||graph.edges.filter(e=>e.from===n.id).length<2))warnings.push(`${n.title}: set a condition and connect both branches.`);
  if(n.type!=='end'&&!graph.edges.some(e=>e.from===n.id))warnings.push(`${n.title}: add a next step.`);
 }
 return [...new Set(warnings)];
}
export function saveApprovalDesign(state,actor,input){
 if(!canManageWorkflows(actor))throw Object.assign(new Error('Only Admin, Finance or Directors can save workflow designs.'),{status:403});
 const graph=normalizeDesign(input.graph),projectId=graph.kind==='corporation'?'':String(input.projectId||'');
 if(projectId&&!state.business?.projects?.some(p=>p.id===projectId))throw new Error('Project not found.');
 const designId=String(input.designId||'');
 if(designId&&!/^[a-zA-Z0-9_-]{1,90}$/.test(designId))throw new Error('Invalid design identifier.');
 const key=designKey(graph.kind,projectId,designId),old=state.business?.workflowDesigns?.find(d=>d.key===key);
 if(input.expectedVersion!==(old?.revision||0))throw Object.assign(new Error('This workflow design changed. Reload the saved version before saving again.'),{status:409});
 const versions=old?[...(old.versions||[]),{revision:old.revision,graph:structuredClone(old.graph),status:old.status,savedBy:old.savedBy,savedAt:old.savedAt,confirmedBy:old.confirmedBy,confirmedAt:old.confirmedAt}]:[];
 const record={key,designId,projectId,graph,versions,status:'draft',revision:(old?.revision||0)+1,savedBy:actor,savedAt:new Date().toISOString()};
 state.business??={projects:[],requests:[]};state.business.workflowDesigns??=[];
 const index=state.business.workflowDesigns.findIndex(d=>d.key===key);if(index<0)state.business.workflowDesigns.push(record);else state.business.workflowDesigns[index]=record;
 return structuredClone(record);
}

export function confirmApprovalDesign(state,actor,input){
 if(!canManageWorkflows(actor))throw Object.assign(new Error('Only Admin, Finance or Directors can confirm workflow designs.'),{status:403});
 const record=state.business?.workflowDesigns?.find(d=>d.key===input.key);
 if(!record)throw new Error('Save a draft before confirming.');
 if(record.revision!==input.expectedVersion)throw Object.assign(new Error('The design changed. Reload before confirming.'),{status:409});
 if(record.status==='confirmed')throw new Error('This revision is already confirmed.');
 const warnings=designWarnings(normalizeDesign(record.graph));if(warnings.length)throw new Error('Resolve design checks before confirming: '+warnings.join(' '));
 record.status='confirmed';record.confirmedBy=actor;record.confirmedAt=new Date().toISOString();
 return structuredClone(record);
}
