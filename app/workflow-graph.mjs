export const END = 'end';
export function normalizeWorkflow(steps) {
  return steps.map((step, index) => ({
    ...structuredClone(step), kind: step.kind || 'approval',
    ...(step.kind === 'condition'
      ? { yes: step.yes ?? steps[index + 1]?.id ?? END, no: step.no ?? END }
      : { next: step.next ?? steps[index + 1]?.id ?? END }),
    position: step.position || { x: 140 + (index % 3) * 320, y: 80 + Math.floor(index / 3) * 230 },
  }));
}
export const outgoing = node => node.kind === 'condition' ? [['yes',node.yes],['no',node.no]] : [['next',node.next]];
export function validateGraph(steps) {
  const nodes = normalizeWorkflow(steps), byId = new Map(nodes.map(n=>[n.id,n]));
  if (!nodes.length) throw new Error('Add at least one approval node.');
  if (nodes.some(n=>['start',END].includes(n.id))) throw new Error('Reserved node ID.');
  for (const node of nodes) {
    for (const [,target] of outgoing(node)) {
      if (target !== END && !byId.has(target)) throw new Error(`Connect every route from "${node.name}" to a node or End.`);
    }
  }
  const done = new Set(), visiting = new Set();
  function visit(id) {
    if (id === END) return;
    if (visiting.has(id)) throw new Error('The workflow contains a loop. Connect routes forward to End.');
    if (done.has(id)) return;
    visiting.add(id);
    for (const [,target] of outgoing(byId.get(id))) visit(target);
    visiting.delete(id); done.add(id);
  }
  visit(nodes[0].id);
  if (done.size !== nodes.length) throw new Error('Some nodes are disconnected from Start. Connect or remove them.');
  if (!nodes.some(n=>n.kind === 'approval')) throw new Error('Add at least one approval node.');
  return nodes;
}
export function traceGraph(steps, amount, department, matches) {
  const nodes = validateGraph(steps), byId = new Map(nodes.map(n=>[n.id,n]));
  let id=nodes[0].id; const approvals=[], visited=[], edges=[];
  while(id !== END) {
    const node=byId.get(id); visited.push(id);
    const match=matches(node,amount,department);
    const port=node.kind==='condition'?(match?'yes':'no'):'next';
    if(node.kind==='approval'&&match) approvals.push(node);
    edges.push({from:id,port,to:node[port]});id=node[port];
  }
  return {approvals,visited,edges};
}
