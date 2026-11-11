import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentTotals,ledgerTotals} from '../app/oa-ledger.mjs';
test('unapproved budgets and selected quotes are not scheduled debt',()=>{
 assert.deepEqual(paymentTotals({amount:10000,selectedQuote:'q',quotes:[{id:'q',amount:12000}]}),{scheduled:false,paid:0,outstanding:0});
});
test('partial cancellation keeps paid history and excludes cancelled balance',()=>{
 assert.deepEqual(paymentTotals({payments:[{amount:100,status:'Paid'},{amount:200,status:'Cancelled'},{amount:300,status:'Ready'},{amount:400,status:'Review'},{amount:500,status:'Pending'}]}),{scheduled:true,paid:100,outstanding:1200});
 assert.deepEqual(paymentTotals({payments:[{amount:200,status:'Cancelled'}]}),{scheduled:false,paid:0,outstanding:0});
});
test('ledger aggregates actual instalments to currency precision',()=>{
 const requests=[{payments:[{amount:0.1,status:'Paid'},{amount:0.1,status:'Ready'}]},{payments:[{amount:0.2,status:'Paid'},{amount:0.2,status:'Review'}]}];
 assert.deepEqual(ledgerTotals(requests),{paid:0.3,outstanding:0.3});
 assert.deepEqual(ledgerTotals([]),{paid:0,outstanding:0});
});
