import test from 'node:test';
import assert from 'node:assert/strict';
import {createCustomerDemo} from '../app/customer-demo.mjs';

test('public customer preview uses isolated sample data and decisions never share state',()=>{
 const demo=createCustomerDemo(),other=createCustomerDemo(),view=demo.read();
 const pending=view.projects[0].requests.find(r=>r.status==='Awaiting your confirmation');
 const input={revision:view.revision,id:pending.id,reviewId:pending.review.id,decision:'approve'};
 demo.decide(input);
 assert.equal(demo.read().projects[0].requests.find(r=>r.id===pending.id).progress,'Internal pre-approval');
 assert.throws(()=>demo.decide(input));
 assert.ok(other.read().projects[0].requests.some(r=>r.status==='Awaiting your confirmation'));
 view.projects.length=0;assert.equal(demo.read().projects.length,2);
 assert.ok(demo.read().projects[0].requests.some(r=>r.status==='Completed'&&r.completion.files.length));
});
