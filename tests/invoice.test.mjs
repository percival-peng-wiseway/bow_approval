import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseInvoice,parseDate} from '../ocr/parse.mjs';
const invoice=`Harbour Office Pty Ltd
TAX INVOICE
ABN: 12 345 678 901
Invoice Number: INV-2026-1042
Invoice Date: 16 October 2026
Due Date: 30/10/2026
Bill To: Pacific Ledger
Office furniture
Subtotal AUD 1,200.00
GST (10%) AUD 120.00
TOTAL AUD 1,320.00`;
test('extracts labeled AU invoice fields and separates subtotal, GST and total',()=>{
 const r=parseInvoice(invoice);assert.equal(r.fields.supplier,'Harbour Office Pty Ltd');assert.equal(r.fields.reference,'INV-2026-1042');
 assert.equal(r.fields.date,'2026-10-16');assert.equal(r.fields.dueDate,'2026-10-30');assert.equal(r.fields.abn,'12345678901');assert.equal(r.fields.currency,'AUD');
 assert.equal(r.fields.subtotal,1200);assert.equal(r.fields.tax,120);assert.equal(r.fields.total,1320);assert.equal(r.evidence.supplier.kind,'header candidate');
});
test('does not invent GST or currency from dollar signs and supports zero/integer tax',()=>{
 const r=parseInvoice('Supplier: Example Pty Ltd\nInvoice # INV-33\nTotal $110.00');assert.equal(r.fields.tax,null);assert.equal(r.fields.subtotal,null);assert.equal(r.fields.currency,'');
 const zero=parseInvoice('Subtotal AUD 100\nGST 0\nTotal AUD 100');assert.equal(zero.fields.tax,0);assert.equal(zero.fields.total,100);
});
test('does not treat subtotal, GST total, total paid or balance due as invoice total',()=>{
 const r=parseInvoice('Subtotal AUD 200.00\nTotal GST AUD 20.00\nTotal paid AUD 50.00\nBalance due AUD 170.00');assert.equal(r.fields.subtotal,200);assert.equal(r.fields.tax,20);assert.equal(r.fields.total,220);assert.equal(r.evidence.total.kind,'calculated');
});
test('missing fields stay empty and customer never becomes supplier',()=>{
 const r=parseInvoice('TAX INVOICE\nBill To: Customer Pty Ltd\nCustomer Pty Ltd\nTotal AUD 110.00');assert.equal(r.fields.supplier,'');assert.equal(r.fields.date,'');assert.equal(r.fields.reference,'');
});
test('foreign currencies, credits and conflicting total candidates are explicit',()=>{
 const r=parseInvoice('CREDIT NOTE\nSubtotal USD 100.00\nTax USD 10.00\nTotal USD 110.00\nTotal USD 130.00');assert.equal(r.fields.currency,'USD');assert.equal(r.fields.total,null);assert.ok(r.warnings.some(w=>w.includes('Several different total')));assert.ok(r.warnings.some(w=>w.includes('credit note')));assert.ok(r.warnings.some(w=>w.includes('AUD only')));
});
test('label-value on following line, reconciliation and AU date handling',()=>{
 const r=parseInvoice('Supplier: ACME\nInvoice Number\nABC-2026-100\nInvoice Date\n16/10/2026\nDue Date\n30/10/2026\nSubtotal\nAUD 100.00\nGST (10%)\nAUD 10.00\nTotal AUD 115.00');
 assert.equal(r.fields.reference,'ABC-2026-100');assert.equal(r.fields.date,'2026-10-16');assert.equal(r.fields.dueDate,'2026-10-30');assert.equal(r.fields.subtotal,100);assert.equal(r.fields.tax,10);assert.ok(r.warnings.some(w=>w.includes('does not match')));
 assert.equal(parseDate('31/02/2026'),null);assert.equal(parseDate('2026-10-16'),'2026-10-16');assert.equal(parseDate('Oct 16, 2026'),'2026-10-16');
});
