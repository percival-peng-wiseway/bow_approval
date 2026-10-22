import {validateGraph, traceGraph} from './workflow-graph.mjs';
// Independent implementation based on public ApprovalMax documentation.
// Existing IDs are retained so saved requests, decisions and approver assignments remain valid.
export const users = [
  { id: 'employee', name: 'Employee', inactive: true, role: 'Employee', initials: 'EM' },
  { id: 'alex', name: 'Kate', role: 'Admin', initials: 'KA' },
  { id: 'jamie', name: 'Lewis', role: 'Finance', initials: 'LE' },
  { id: 'sam', name: 'Joe', role: 'Director', initials: 'JO' },
  { id: 'director-b', name: 'Jason', role: 'Director', initials: 'JA' },
  { id: 'director-c', name: 'Steve', role: 'Director', initials: 'ST' },
  { id: 'taylor', name: 'Hassan Kassem', role: 'PM', initials: 'HK' },
  { id: 'pm-b', name: 'Nidhi Pandey', role: 'PM', initials: 'NP' },
  { id: 'pm-c', name: 'PM C', inactive: true, role: 'PM', initials: 'PC' },
  { id: 'pm-d', name: 'PM D', inactive: true, role: 'PM', initials: 'PD' },
];
export const canManageWorkflows = actor => users.some(u => u.id === actor && ['Admin','Finance','Director'].includes(u.role));
export function workflowInfo(state, id) {
  if (!Object.hasOwn(state.workflows, id)) return null;
  if (['Bill','Purchase Order'].includes(id)) return {id, type:id, name:id+' workflow'};
  const meta=state.workflowMeta?.[id];
  return meta && ['Bill','Purchase Order'].includes(meta.type) ? {...meta,id} : null;
}
export const workflowOptions = (state,type) => Object.keys(state.workflows).map(id=>workflowInfo(state,id)).filter(w=>w&&(!type||w.type===type));
function requestWorkflow(state, request) {
  const id=request.workflowId || request.type, info=workflowInfo(state,id);
  if (!info || info.type!==request.type) throw new Error('Choose a workflow for this request type.');
  return {id,info,steps:state.workflows[id]};
}
export function createWorkflow(state, {name,type,sourceId}, actor) {
  requireUser(actor);
  if (!canManageWorkflows(actor)) throw new Error('Only Admin, Finance or Directors can manage workflows.');
  const clean=String(name||'').trim();
  if (!clean || clean.length>80) throw new Error('Enter a workflow name of 1 to 80 characters.');
  if (!['Bill','Purchase Order'].includes(type)) throw new Error('Choose Bill or Purchase Order.');
  if (workflowOptions(state).some(w=>w.name.toLowerCase()===clean.toLowerCase())) throw new Error('A workflow with this name already exists.');
  if(sourceId && workflowInfo(state,sourceId)?.type!==type) throw new Error('Copy a workflow of the same request type.');
  const steps=sourceId ? clone(state.workflows[sourceId]) : [{id:'approval',kind:'approval',name:'Finance approval',mode:'Any',approvers:['jamie'],minAmount:0,maxAmount:null,departments:[],next:'end',position:{x:160,y:80}}];
  validateSteps(steps);validateGraph(steps);
  const id=uid('workflow');
  state.workflows[id]=steps;
  state.workflowMeta??={};state.workflowMeta[id]={name:clean,type};
  return id;
}

let sequence = 0;
const uid = prefix => `${prefix}-${Date.now().toString(36)}-${(++sequence).toString(36)}`;
const clone = value => JSON.parse(JSON.stringify(value));
const round = value => {
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER / 100) {
    throw new Error('Amount is outside the supported currency range.');
  }
  return Math.round((value + Number.EPSILON) * 100) / 100;
};
const validUser = id => users.some(user => user.id === id);
const requireUser = id => { if (!validUser(id)) throw new Error('Unknown user.'); };
const find = (state, id) => {
  const request = state.requests.find(item => item.id === id);
  if (!request) throw new Error('Request not found.');
  return request;
};
const record = (request, actor, action, detail = '') => {
  request.history.push({ id: uid('event'), at: new Date().toISOString(), actor, action, detail });
};

export const money = value => new Intl.NumberFormat('en-AU', {
  style: 'currency', currency: 'AUD', minimumFractionDigits: 2,
}).format(Number(value) || 0);

export function total(request) {
  return round((request.items || []).reduce((sum, item) => {
    const net = round(Number(item.quantity) * Number(item.unitPrice));
    return sum + net + round(net * Number(item.taxRate || 0) / 100);
  }, 0));
}

function validateItems(items) {
  if (!Array.isArray(items) || !items.length) throw new Error('Add at least one line item.');
  for (const item of items) {
    if (!item || typeof item !== 'object') throw new Error('Each line item must contain valid fields.');
    if (!String(item.description || '').trim()) throw new Error('Each line needs a description.');
    if (!Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) throw new Error('Quantity must be greater than zero.');
    if (!Number.isFinite(Number(item.unitPrice)) || Number(item.unitPrice) < 0) throw new Error('Unit price must be zero or greater.');
    if (!Number.isFinite(Number(item.taxRate ?? 0)) || Number(item.taxRate ?? 0) < 0 || Number(item.taxRate ?? 0) > 100) throw new Error('Tax rate must be between 0 and 100.');
  }
  total({ items }); // Guard multiplication, tax and accumulated-total overflow.
}

function validateSteps(steps) {
  if (!Array.isArray(steps) || !steps.length) throw new Error('At least one approval step is required.');
  const ids = new Set();
  for (const step of steps) {
    if (!step.id || ids.has(step.id)) throw new Error('Approval step IDs must be unique.');
    ids.add(step.id);
    if (step.kind && !['approval', 'condition'].includes(step.kind)) throw new Error('Unknown workflow node type.');
    if (step.kind !== 'condition' && !['Any', 'All'].includes(step.mode)) throw new Error('Approval condition must be Any or All.');
    if (!step.name?.trim()) throw new Error('Each approval step needs a name.');
    if (step.kind !== 'condition' && (!Array.isArray(step.approvers) || !step.approvers.length || step.approvers.some(id => !validUser(id)))) throw new Error('Each step needs valid approvers.');
    if (step.kind !== 'condition' && new Set(step.approvers).size !== step.approvers.length) throw new Error('Duplicate approvers are not allowed.');
    const min = Number(step.minAmount ?? 0);
    const max = step.maxAmount == null || step.maxAmount === '' ? null : Number(step.maxAmount);
    if (!Number.isFinite(min) || min < 0 || min > Number.MAX_SAFE_INTEGER / 100) throw new Error('Approval threshold must be zero or greater.');
    if (max !== null && (!Number.isFinite(max) || max <= min || max > Number.MAX_SAFE_INTEGER / 100)) throw new Error('Maximum amount must be greater than minimum amount.');
    if (step.position && (!Number.isFinite(step.position.x) || !Number.isFinite(step.position.y))) throw new Error('Invalid node position.');
    if (step.departments !== undefined && (!Array.isArray(step.departments) || step.departments.some(d => typeof d !== 'string' || !d.trim()) || new Set(step.departments).size !== step.departments.length)) throw new Error('Choose valid, unique departments.');
  }
}

export function matchesStep(step, amount, department) {
  return amount >= Number(step.minAmount ?? 0) &&
    (step.maxAmount == null || step.maxAmount === '' || amount < Number(step.maxAmount)) &&
    (!step.departments?.length || step.departments.includes(department));
}

function prepareSteps(state, request) {
  validateItems(request.items);
  if (!request.supplier?.trim()) throw new Error('Supplier is required.');
  const workflow = requestWorkflow(state,request).steps;
  validateSteps(workflow);
  const route = traceGraph(workflow, total(request), request.department, matchesStep);
  const steps = route.approvals.map(step => ({
    ...clone(step), approvedBy: [], status: 'Pending',
  }));
  if (!steps.length) throw new Error('No approval rule matches this request.');
  for (const step of steps) {
    const eligible = step.approvers.filter(id => id !== request.requester);
    if (!eligible.length || (step.mode === 'All' && eligible.length !== step.approvers.length)) {
      throw new Error('This workflow cannot be completed without self-approval. Assign another approver.');
    }
  }
  steps[0].status = 'On approval';
  return steps;
}

export function currentStep(request) {
  return request.status === 'On approval' ? request.steps?.[request.stepIndex] || null : null;
}

export function canDecide(request, actor) {
  const step = currentStep(request);
  return Boolean(validUser(actor) && actor !== request.requester && step &&
    step.approvers.includes(actor) && !step.approvedBy.includes(actor));
}

export function submit(state, id, actor) {
  requireUser(actor);
  const request = find(state, id);
  if (request.requester !== actor) throw new Error('Only the requester can submit this request.');
  if (!['Draft', 'Rejected'].includes(request.status)) throw new Error('Only draft or rejected requests can be submitted.');
  const steps = prepareSteps(state, request);
  request.workflowId = requestWorkflow(state,request).id;
  request.steps = steps;
  request.stepIndex = 0;
  request.status = 'On approval';
  record(request, actor, 'Submitted for approval', `Workflow snapshot: ${steps.map(step => step.name).join(' → ')}`);
  return request;
}

export function decide(state, id, actor, decision, reason = '') {
  requireUser(actor);
  const request = find(state, id);
  if (!canDecide(request, actor)) throw new Error('You are not eligible to decide at the current step.');
  const normalized = String(decision).toLowerCase();
  if (!['approve', 'approved', 'reject', 'rejected'].includes(normalized)) throw new Error('Choose approve or reject.');
  const step = currentStep(request);
  if (normalized.startsWith('reject')) {
    if (!reason.trim()) throw new Error('Please give a reason for rejection.');
    request.status = 'Rejected';
    step.status = 'Rejected';
    record(request, actor, 'Rejected', `${step.name}: ${reason.trim()}`);
    return request;
  }
  step.approvedBy.push(actor);
  record(request, actor, 'Approved step', `${step.name}${reason.trim() ? `: ${reason.trim()}` : ''}`);
  if (step.mode === 'Any' || step.approvers.every(id => step.approvedBy.includes(id))) {
    step.status = 'Approved';
    request.stepIndex += 1;
    if (request.stepIndex >= request.steps.length) {
      request.status = 'Approved';
      record(request, actor, 'Final approval', 'All required approval steps completed.');
    } else request.steps[request.stepIndex].status = 'On approval';
  }
  return request;
}

export function createRequest(state, data, actor, { draft = false } = {}) {
  requireUser(actor);
  if (!['Bill', 'Purchase Order'].includes(data.type)) throw new Error('Choose Bill or Purchase Order.');
  validateItems(data.items);
  if (!String(data.supplier || '').trim()) throw new Error('Supplier is required.');
  const request = {
    id: uid(data.type === 'Bill' ? 'bill' : 'po'), type: data.type,
    workflowId: data.workflowId || data.type,
    supplier: data.supplier.trim(), reference: String(data.reference || '').trim(),
    date: data.date || new Date().toISOString().slice(0, 10), dueDate: data.dueDate || '',
    department: data.department || 'Operations', currency: 'AUD', requester: actor,
    status: 'Draft', note: data.note || '',
    items: data.items.map(item => ({ ...clone(item), quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), taxRate: Number(item.taxRate || 0) })),
    steps: [], stepIndex: 0, history: [], attachments: clone(data.attachments || []),
  };
  requestWorkflow(state,request);
  if (!draft) prepareSteps(state, request); // Validate routing before changing state.
  record(request, actor, 'Created', `${request.type} ${request.reference}`.trim());
  state.requests.unshift(request);
  if (!draft) submit(state, request.id, actor);
  return request;
}

export function updateRequest(state, id, data, actor) {
  requireUser(actor);
  const request = find(state, id);
  if (request.requester !== actor) throw new Error('Only the requester can edit this request.');
  if (!['Draft', 'Rejected'].includes(request.status)) throw new Error('Only draft or rejected requests can be edited.');
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Provide valid request fields.');
  const fields = ['type', 'supplier', 'reference', 'date', 'dueDate', 'department', 'note', 'items', 'attachments', 'workflowId'];
  const changes = {};
  for (const field of fields) if (Object.hasOwn(data, field)) changes[field] = data[field];
  const candidate = { ...request, ...changes };
  candidate.workflowId = Object.hasOwn(data,'workflowId') ? data.workflowId : (candidate.type!==request.type ? candidate.type : (request.workflowId||request.type));
  requestWorkflow(state,candidate);
  if (!['Bill', 'Purchase Order'].includes(candidate.type)) throw new Error('Choose Bill or Purchase Order.');
  for (const field of ['supplier', 'reference', 'date', 'dueDate', 'department', 'note']) {
    if (typeof candidate[field] !== 'string') throw new Error(`${field} must be text.`);
  }
  if (!candidate.supplier.trim()) throw new Error('Supplier is required.');
  if (!candidate.department.trim()) throw new Error('Department is required.');
  for (const field of ['date', 'dueDate']) {
    const value = candidate[field];
    if (field === 'dueDate' && value === '') continue;
    const parsed = new Date(`${value}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new Error(`${field} must be a valid date.`);
    }
  }
  validateItems(candidate.items);
  if (!Array.isArray(candidate.attachments) || candidate.attachments.some(file =>
    !file || typeof file !== 'object' || typeof file.name !== 'string' || !file.name.trim())) {
    throw new Error('Attachments must have a file name.');
  }
  // Build detached, validated values before mutating any saved request fields.
  const updated = Object.fromEntries(fields.map(field => [field, clone(candidate[field])]));
  updated.supplier = updated.supplier.trim();
  updated.reference = updated.reference.trim();
  updated.department = updated.department.trim();
  updated.items = updated.items.map(item => ({ ...item, quantity: Number(item.quantity),
    unitPrice: Number(item.unitPrice), taxRate: Number(item.taxRate || 0) }));
  const removeMatch = request.matchedPO && !eligiblePOs(state, { ...request, ...updated }).some(po => po.id === request.matchedPO);
  Object.assign(request, updated);
  if (removeMatch) delete request.matchedPO;
  record(request, actor, 'Edited', `${Object.keys(changes).join(', ') || 'Request details'}${removeMatch ? '; incompatible PO match removed' : ''}`);
  return request;
}

export function addComment(state, id, actor, text) {
  requireUser(actor);
  const request = find(state, id);
  if (!String(text || '').trim()) throw new Error('Enter a comment.');
  record(request, actor, 'Comment', String(text).trim());
  return request;
}

export function eligiblePOs(state, bill) {
  if (bill.type !== 'Bill') return [];
  return state.requests.filter(po => po.type === 'Purchase Order' && po.status === 'Approved' &&
    !po.closed && po.supplier === bill.supplier && po.currency === bill.currency);
}

export function matchPO(state, billId, poId, actor) {
  requireUser(actor);
  const bill = find(state, billId);
  if (bill.type !== 'Bill' || !['Draft', 'On approval'].includes(bill.status)) throw new Error('Only unapproved bills can be matched.');
  if (actor !== bill.requester && !canDecide(bill, actor) && actor !== 'jamie') throw new Error('Only the requester, current approver or finance can match this bill.');
  const po = eligiblePOs(state, bill).find(item => item.id === poId);
  if (!po) throw new Error('Select an approved, open PO with the same supplier and currency.');
  bill.matchedPO = po.id;
  record(bill, actor, 'PO matched', `${po.reference} · ${money(total(po))}`);
  return bill;
}

export function auditCsv(request) {
  const cell = value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = [['Request', 'Reference', 'Timestamp', 'Actor', 'Action', 'Detail'],
    ...request.history.map(event => [request.id, request.reference, event.at,
      users.find(user => user.id === event.actor)?.name || event.actor, event.action, event.detail])];
  return rows.map(row => row.map(cell).join(',')).join('\r\n');
}

export function updateWorkflow(state, type, steps, actor) {
  requireUser(actor);
  if (!canManageWorkflows(actor)) throw new Error('Only Admin, Finance or Directors can manage workflows.');
  if (!workflowInfo(state,type)) throw new Error('Unknown workflow type.');
  validateSteps(steps);
  const nodes = validateGraph(steps);
  state.workflows[type] = nodes.map(step => ({ id: step.id, kind: step.kind, name: step.name.trim(),
    ...(step.kind === 'condition' ? {yes:step.yes, no:step.no} : {mode:step.mode, approvers:[...step.approvers], next:step.next}),
    minAmount: Number(step.minAmount ?? 0),
    maxAmount: step.maxAmount == null || step.maxAmount === '' ? null : Number(step.maxAmount),
    departments: [...(step.departments || [])], position:{...step.position} }));
  return state.workflows[type];
}

export function initialState() {
  const baseSteps = [
    { id: 'department', name: 'Department approval', mode: 'Any', approvers: ['alex', 'jamie'], minAmount: 0 },
    { id: 'finance', name: 'Director approval', mode: 'All', approvers: ['sam'], minAmount: 10000 },
  ];
  const state = {
    actor: 'alex', requests: [], workflows: { Bill: clone(baseSteps), 'Purchase Order': clone(baseSteps) },
    budgets: [
      { id: 'operations', name: 'Operations', department: 'Operations', period: 'October 2026', currency: 'AUD', total: 60000, spent: 32500, committed: 12100 },
      { id: 'marketing', name: 'Marketing', department: 'Marketing', period: 'October 2026', currency: 'AUD', total: 25000, spent: 17200, committed: 9200 },
      { id: 'technology', name: 'Technology', department: 'Technology', period: 'October 2026', currency: 'AUD', total: 40000, spent: 21400, committed: 15400 },
      { id: 'people', name: 'People & Culture', department: 'People & Culture', period: 'October 2026', currency: 'AUD', total: 18000, spent: 8400, committed: 4400 },
    ],
  };
  const examples = [
    ['Purchase Order', 'TalentBridge', 'PO-2026-0142', 4000, 'People & Culture', 'Recruitment services — project coordinator', 'Approved'],
    ['Bill', 'Telstra', 'TEL-049821', 389, 'Operations', 'Business internet and mobile services', 'Approved'],
    ['Bill', 'Officeworks', 'OW-028491', 850, 'Operations', 'Office supplies and meeting room equipment', 'Rejected'],
    ['Purchase Order', 'Dell Australia', 'PO-2026-0151', 14000, 'Technology', 'Ten laptops for the Melbourne team', 'On approval'],
    ['Bill', 'Brightside Creative', 'BC-2026-109', 6200, 'Marketing', 'Spring campaign creative production', 'On approval'],
    ['Purchase Order', 'BuildRight Supplies', 'PO-2026-0154', 8500, 'Operations', 'Site safety equipment and materials', 'On approval'],
    ['Bill', 'Amazon Web Services', 'AWS-AU-1026', 2400, 'Technology', 'October cloud infrastructure', 'Draft'],
    ['Bill', 'Metro Facilities', 'MF-16490', 12000, 'Operations', 'Quarterly facilities maintenance', 'On approval'],
    ['Bill', 'TalentBridge', 'TB-2026-081', 4000, 'People & Culture', 'Recruitment fee — project coordinator', 'On approval'],
  ];
  examples.forEach(([type, supplier, reference, price, department, description, status], index) => {
    const request = createRequest(state, { type, supplier, reference, department, date: `2026-10-${String(8 + index).padStart(2, '0')}`,
      dueDate: '2026-10-30', note: supplier === 'TalentBridge' ? 'Recruitment services for the new project coordinator. Invoice and approved PO attached for review.' : '',
      items: [{ description, quantity: 1, unitPrice: price, taxRate: 10, account: department === 'People & Culture' ? 'Recruitment expenses' : `${department} expenses` }],
      attachments: [{ name: `${reference}.pdf`, size: '142 KB', demo: true }],
    }, 'taylor', { draft: status === 'Draft' });
    request.id = `demo-${index + 1}`;
    if (status === 'Approved') {
      decide(state, request.id, 'alex', 'approve');
      if (request.status !== 'Approved') decide(state, request.id, 'sam', 'approve');
    }
    if (status === 'Rejected') decide(state, request.id, 'alex', 'reject', 'Please attach an itemised receipt.');
    if (supplier === 'Metro Facilities') decide(state, request.id, 'alex', 'approve');
  });
  const primary = state.requests.find(request => request.reference === 'TB-2026-081');
  matchPO(state, primary.id, 'demo-1', 'taylor');
  addComment(state, primary.id, 'taylor', 'The placement started on 12 October. Please approve the final recruitment fee.');
  return state;
}
