import {normalizeDesign} from './approval-design.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function evaluateDesignCondition(condition,values){
 if(condition.field==='custom'||values[condition.field]===undefined)return null;
 let actual=values[condition.field],expected=condition.value;
 if(condition.field==='amount'){actual=Number(actual);expected=Number(expected);if(!Number.isFinite(actual)||!Number.isFinite(expected)||String(condition.value).trim()==='')return null;}
 else {actual=String(actual).toLowerCase();expected=String(expected).toLowerCase();}
 switch(condition.operator){case 'gte':return actual>=expected;case 'gt':return actual>expected;case 'lte':return actual<=expected;case 'lt':return actual<expected;case 'eq':return actual===expected;case 'neq':return actual!==expected;default:return null;}
}
// A graph walkthrough only: no business commands, approvals, payments or email.
export function previewDesign(raw,values={},choices={}){
 const graph=normalizeDesign(raw),starts=graph.nodes.filter(n=>n.type==='start'),steps=[],visited=new Set();
 if(starts.length!==1)return {steps,message:'Use exactly one start node.',choices:[]};
 let node=starts[0];
 while(node){
  if(visited.has(node.id))return {steps,message:'Loop reached. Change the test inputs to preview another iteration.',choices:[]};
  visited.add(node.id);steps.push(node);
  const edges=graph.edges.filter(e=>e.from===node.id);
  if(!edges.length)return {steps,message:node.type==='end'?'Preview complete.':'No next step connected.',choices:[]};
  let edge;
  if(node.type==='condition'){
   const result=evaluateDesignCondition(node.condition,values);
   if(result!==null){const matches=edges.filter(e=>new RegExp('^(?:'+(result?'yes|true':'no|false')+')(?=$|[\\s·:—-])','i').test(e.label.trim()));if(matches.length===1)edge=matches[0];}
   if(!edge)edge=edges.find(e=>e.id===choices[node.id]);
  }else edge=edges.length===1?edges[0]:edges.find(e=>e.id===choices[node.id]);
  if(!edge)return {steps,message:node.type==='condition'?'Choose a branch for this condition.':'Choose the next route.',choices:edges,nodeId:node.id};
  node=graph.nodes.find(n=>n.id===edge.to);
 }
 return {steps,message:'No next step found.',choices:[]};
}
export function mountDesignTest(root,getGraph,person){
 root.innerHTML=`<details class="flow-test"><summary>Test design</summary><p>Sandbox preview only. Approvals and actions are assumed complete; live requests remain unchanged.</p><form class="flow-test-inputs"><label>Amount · AUD<input name="amount" type="number" value="1000" min="0" step="0.01" required></label><label>Applicant role<select name="requesterRole"><option>Employee</option><option>PM</option><option>Director</option><option>Finance</option><option>Admin</option></select></label>${[['notifyCustomer','Notify customer'],['aboveBudget','Above approved budget'],['finalPayment','Final instalment'],['hasMorePayments','More instalments']].map(([id,label])=>`<label class="flow-test-check"><input name="${id}" type="checkbox">${label}</label>`).join('')}<button type="submit">Run preview</button></form><div class="flow-test-result" aria-live="polite"></div></details>`;
 let graph,values,choices={};const result=root.querySelector('.flow-test-result');
 function render(){try{const output=previewDesign(graph,values,choices);result.innerHTML=`<h3>${esc(graph.name)} · Test route</h3><ol>${output.steps.map(n=>`<li><strong>${esc(n.title)}</strong>${n.participants.length?`<span>${esc(n.participants.map(person).join(' / '))}${n.type==='approval'?' · '+(n.mode==='All'?'All must approve':'Any one can approve'):''}</span>`:''}</li>`).join('')}</ol><p>${esc(output.message)}</p><div class="flow-test-branches">${output.choices.map(e=>`<button type="button" data-test-edge="${esc(e.id)}">${esc(e.label||'Continue')} → ${esc(graph.nodes.find(n=>n.id===e.to)?.title)}</button>`).join('')}</div>`;result.querySelectorAll('[data-test-edge]').forEach(b=>b.onclick=()=>{choices[output.nodeId]=b.dataset.testEdge;render();});}catch(e){result.textContent=e.message;}}
 root.querySelector('form').onsubmit=e=>{e.preventDefault();if(!e.target.reportValidity())return;graph=structuredClone(getGraph());const fields=new FormData(e.target);values={amount:Number(fields.get('amount')),requesterRole:fields.get('requesterRole'),...Object.fromEntries(['notifyCustomer','aboveBudget','finalPayment','hasMorePayments'].map(k=>[k,fields.has(k)]))};choices={};render();};
 return ()=>{result.innerHTML='';graph=null;choices={};};
}
