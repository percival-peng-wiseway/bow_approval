import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, createRequest, updateRequest, total, decide, submit, currentStep, canDecide, updateWorkflow, matchPO, eligiblePOs, addComment, auditCsv } from '../app/domain.mjs';

const data = amount => ({ type: 'Bill', supplier: 'Test Supplier', reference: 'TEST-1', items: [{ description: 'Service', quantity: 1, unitPrice: amount, taxRate: 0, account: 'Consulting' }] });

test('seed provides meaningful pending, draft, rejected and approved examples', () => {
  const state = initialState();
  assert.equal(state.requests.length, 9);
  assert.equal(total(state.requests[0]), 4400);
  assert.equal(state.requests[0].matchedPO, 'demo-1');
  assert.deepEqual(new Set(state.requests.map(r => r.status)), new Set(['Draft', 'On approval', 'Approved', 'Rejected']));
});

test('inclusive threshold and sequential approvals use gross rounded amount', () => {
  const state = initialState();
  const below = createRequest(state, data(9999.99), 'taylor');
  const boundary = createRequest(state, data(10000), 'taylor');
  assert.equal(below.steps.length, 1);
  assert.equal(boundary.steps.length, 2);
  assert.throws(() => decide(state, boundary.id, 'sam', 'approve'), /not eligible/);
  decide(state, boundary.id, 'alex', 'approve');
  assert.equal(boundary.status, 'On approval');
  assert.equal(currentStep(boundary).approvers[0], 'sam');
  decide(state, boundary.id, 'sam', 'approve');
  assert.equal(boundary.status, 'Approved');
  assert.equal(currentStep(boundary), null);
  assert.equal(total({ items: [{ quantity: 3, unitPrice: 0.1, taxRate: 10 }] }), 0.33);
});

test('Any completes once; All waits for every assigned approver and prevents duplicate decisions', () => {
  const state = initialState();
  const any = createRequest(state, data(200), 'taylor');
  decide(state, any.id, 'jamie', 'approve');
  assert.equal(any.status, 'Approved');
  updateWorkflow(state, 'Bill', [{ id: 'dual', name: 'Dual approval', mode: 'All', approvers: ['alex', 'jamie'], minAmount: 0 }], 'sam');
  const all = createRequest(state, data(200), 'taylor');
  decide(state, all.id, 'alex', 'approve');
  assert.equal(all.status, 'On approval');
  assert.equal(canDecide(all, 'alex'), false);
  assert.throws(() => decide(state, all.id, 'alex', 'approve'), /not eligible/);
  decide(state, all.id, 'jamie', 'approve');
  assert.equal(all.status, 'Approved');
});

test('self-approval blocked; missing or impossible routing fails before state mutation', () => {
  const state = initialState();
  const request = createRequest(state, data(200), 'alex');
  assert.throws(() => decide(state, request.id, 'alex', 'approve'), /not eligible/);
  decide(state, request.id, 'jamie', 'approve');
  const before = state.requests.length;
  state.workflows.Bill[0].approvers = [];
  assert.throws(() => createRequest(state, data(200), 'taylor'), /valid approvers/);
  assert.equal(state.requests.length, before);
  state.workflows.Bill[0].approvers = ['taylor'];
  assert.throws(() => createRequest(state, data(200), 'taylor'), /self-approval/);
  assert.equal(state.requests.length, before);
});

test('rejection is terminal until requester resubmits with a new snapshot', () => {
  const state = initialState();
  const request = createRequest(state, data(200), 'taylor');
  assert.throws(() => decide(state, request.id, 'alex', 'reject'), /reason/);
  assert.equal(request.status, 'On approval');
  decide(state, request.id, 'alex', 'reject', 'Missing receipt');
  assert.equal(request.status, 'Rejected');
  assert.throws(() => decide(state, request.id, 'jamie', 'approve'), /not eligible/);
  assert.throws(() => submit(state, request.id, 'alex'), /Only the requester/);
  submit(state, request.id, 'taylor');
  assert.equal(request.status, 'On approval');
  assert.deepEqual(currentStep(request).approvedBy, []);
});

test('workflow changes affect future submission, never an in-flight snapshot', () => {
  const state = initialState();
  const old = createRequest(state, data(200), 'taylor');
  updateWorkflow(state, 'Bill', [{ id: 'cfo', name: 'CFO only', mode: 'All', approvers: ['sam'], minAmount: 0 }], 'sam');
  const next = createRequest(state, data(200), 'taylor');
  assert.deepEqual(old.steps[0].approvers, ['alex', 'jamie']);
  assert.deepEqual(next.steps[0].approvers, ['sam']);
});

test('matching enforces approval, open status, currency, supplier and pending bill', () => {
  const state = initialState();
  const bill = state.requests.find(request => request.reference === 'TB-2026-081');
  const po = state.requests.find(request => request.id === 'demo-1');
  assert.equal(eligiblePOs(state, bill).length, 1);
  for (const [key, value] of [['closed', true], ['status', 'Draft'], ['currency', 'USD'], ['supplier', 'Other']]) {
    const original = po[key]; po[key] = value;
    assert.throws(() => matchPO(state, bill.id, po.id, 'alex'), /approved, open PO/);
    po[key] = original;
  }
  matchPO(state, bill.id, po.id, 'alex');
  decide(state, bill.id, 'alex', 'approve');
  assert.throws(() => matchPO(state, bill.id, po.id, 'alex'), /unapproved bills/);
});

test('comments append attributable history and audit CSV neutralises formula cells', () => {
  const state = initialState();
  const request = createRequest(state, { ...data(200), reference: '=HYPERLINK("bad")' }, 'taylor');
  addComment(state, request.id, 'alex', '=1+1');
  const event = request.history.at(-1);
  assert.equal(event.actor, 'alex');
  assert.equal(event.action, 'Comment');
  assert.ok(!Number.isNaN(Date.parse(event.at)));
  const csv = auditCsv(request);
  assert.ok(csv.includes('"\'=1+1"'));
  assert.ok(csv.includes('"\'=HYPERLINK(""bad"")"'));
});

test('requester edits drafts and rejected requests, protecting workflow and identity fields', () => {
  const state = initialState();
  const request = createRequest(state, data(200), 'taylor', { draft: true });
  const id = request.id;
  const updated = updateRequest(state, id, { supplier: ' Updated supplier ', items: data(10000).items,
    id: 'forged', requester: 'alex', status: 'Approved', history: [], steps: [{ mode: 'Any', approvers: ['taylor'] }],
    currency: 'USD', stepIndex: 999 }, 'taylor');
  assert.equal(updated, request);
  assert.equal(request.id, id);
  assert.equal(request.requester, 'taylor');
  assert.equal(request.status, 'Draft');
  assert.equal(request.currency, 'AUD');
  assert.equal(request.stepIndex, 0);
  assert.deepEqual(request.steps, []);
  assert.equal(request.supplier, 'Updated supplier');
  assert.equal(total(request), 10000);
  assert.equal(request.history[0].action, 'Created');
  assert.equal(request.history.at(-1).action, 'Edited');
  submit(state, id, 'taylor');
  assert.equal(request.steps.length, 2);
  decide(state, id, 'alex', 'reject', 'Correct amount');
  updateRequest(state, id, { items: data(300).items }, 'taylor');
  assert.equal(request.status, 'Rejected');
  assert.equal(request.steps[0].status, 'Rejected');
  submit(state, id, 'taylor');
  assert.equal(request.steps.length, 1);
});

test('request edits reject other users, active states and invalid input atomically', () => {
  const state = initialState();
  const request = createRequest(state, data(200), 'taylor', { draft: true });
  const before = JSON.stringify(request);
  assert.throws(() => updateRequest(state, request.id, { note: 'no' }, 'alex'), /Only the requester/);
  for (const patch of [{ supplier: '' }, { type: 'Expense' }, { items: [] }, { date: '2026-02-30' },
    { dueDate: 'invalid' }, { department: '' }, { attachments: [{ url: 'fake' }] }]) {
    assert.throws(() => updateRequest(state, request.id, patch, 'taylor'));
    assert.equal(JSON.stringify(request), before);
  }
  submit(state, request.id, 'taylor');
  assert.throws(() => updateRequest(state, request.id, { note: 'no' }, 'taylor'), /Only draft or rejected/);
  decide(state, request.id, 'alex', 'approve');
  assert.throws(() => updateRequest(state, request.id, { note: 'no' }, 'taylor'), /Only draft or rejected/);
});

test('editing a matched draft removes incompatible PO association with audit detail', () => {
  const state = initialState();
  const bill = createRequest(state, { ...data(200), supplier: 'TalentBridge' }, 'taylor', { draft: true });
  matchPO(state, bill.id, 'demo-1', 'taylor');
  updateRequest(state, bill.id, { supplier: 'Another supplier' }, 'taylor');
  assert.equal(bill.matchedPO, undefined);
  assert.match(bill.history.at(-1).detail, /PO match removed/);
});

test('currency overflow is rejected before create or edit modifies state', () => {
  const state = initialState();
  const request = createRequest(state, data(200), 'taylor', { draft: true });
  const before = JSON.stringify(state);
  for (const amount of [Infinity, NaN, 1e308, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => createRequest(state, data(amount), 'taylor', { draft: true }));
    assert.throws(() => updateRequest(state, request.id, { items: data(amount).items }, 'taylor'));
    assert.equal(JSON.stringify(state), before);
  }
  assert.throws(() => total({ items: [{ quantity: 1e200, unitPrice: 1e200, taxRate: 0 }] }), /currency range/);
});
