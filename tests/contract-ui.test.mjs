import test from 'node:test';
import assert from 'node:assert/strict';
import {analysisReport,contractExtractionFields,contractAbnForVerification} from '../app/contract-ui.mjs';
test('Contract field extraction only autofills an unambiguous AUD GST-inclusive total',()=>{
 const base={supplierAbn:'51 824 753 556',paymentTerms:'30 days',bankDetails:'Account: Test',currency:'AUD',totalAmount:'AUD 1,800.50 including GST'};
 assert.deepEqual(contractExtractionFields(base),{abn:'51824753556',paymentTerms:'30 days',bankDetails:'Account: Test',amount:'1800.5'});
 for(const override of [{currency:'USD'},{totalAmount:'1,800 excluding GST'},{totalAmount:'$1,500–$2,000 including GST'},{totalAmount:'Deposit 500, total 2000 including GST'},{totalAmount:'2000'},{totalAmount:'-2000 including GST'},{totalAmount:'2,00 including GST'}])assert.equal(contractExtractionFields({...base,...override}).amount,undefined);
 assert.equal(contractExtractionFields({...base,supplierAbn:'ABN unknown'}).abn,undefined);
});
test('Bank display distinguishes unchecked from not found and respects a manually cleared value',()=>{
 const result={model:'test',report:{bankDetails:'Old bank',attentionPoints:[],paymentSchedule:[],uncertainties:[],sources:[]}};
 assert.match(analysisReport(null),/Not checked/);assert.equal(analysisReport(null,{showBank:false}),'');
 assert.match(analysisReport({...result,report:{...result.report,bankDetails:''}}),/Not found/);
 const manual=analysisReport(result,{bankDetails:''});assert.match(manual,/Not found/);assert.doesNotMatch(manual,/Old bank/);
 assert.match(analysisReport(result,{bankDetails:'<script>unsafe</script>'}),/&lt;script&gt;/);
});

test('Automatic ABN verification only uses a complete ABN, including manually entered spaced values',()=>{
 assert.equal(contractAbnForVerification('51 824 753 556'),'51824753556');
 for(const value of ['',null,'Not found','5182475','ABN 51824753556','518247535560','51-824-753-556'])assert.equal(contractAbnForVerification(value),null);
});
