import test from 'node:test';
import assert from 'node:assert/strict';
import {supplierRegister,saveSupplierProfile,recordSupplierSelection} from '../app/suppliers.mjs';
import {saveProject,createBusinessRequest,actBusiness,updateBusinessRequest} from '../app/business.mjs';
import {applyCommand} from '../server/commands.mjs';
const file={name:'contract.txt',data:'data:text/plain;base64,dGVzdA==',size:4};
const check={selectedAbn:'51 824 753 556',status:'checked',checkedAt:'2026-11-01T00:00:00Z',entries:[],warnings:[]};
const quote=(id,supplier,abnCheck=check)=>({id,supplier,amount:100,abnCheck,quoteFiles:[file],contractFiles:[file]});
const request=(id,quotes,selectedQuote,payments=[])=>({id,kind:'service',payingEntity:'Test Development Pty Ltd',projectId:'p',title:id,quotes,selectedQuote,payments,stage:'Payment documents'});
const state=requests=>({business:{projects:[{id:'p',name:'Project'}],requests}});
test('Supplier register combines a selected ABN across projects, ignores losing quotes and does not mutate state',()=>{
 const a=request('a',[quote('q1','Supplier'),quote('loser','Other',null)],'q1',[{id:'paid',status:'Paid',amount:10.1},{id:'ready',status:'Ready',amount:20.2},{id:'cancelled',status:'Cancelled',amount:999}]);
 const b={...request('b',[quote('q2','Supplier Pty Ltd')],'q2',[{status:'Pending',amount:30.3}]),projectId:'p2'};a.archives=[{payments:[{status:'Paid',amount:10.1}]}];
 const s=state([a,b]),before=structuredClone(s),rows=supplierRegister(s);
 assert.equal(rows.length,1);assert.equal(rows[0].abn,'51824753556');assert.equal(rows[0].paid,10.1);assert.equal(rows[0].outstanding,50.5);assert.equal(rows[0].projects.length,2);assert.equal(rows[0].engagements.length,2);assert.deepEqual(s,before);
});
test('Same-name suppliers without confirmed identity remain separate and quotes are not payable totals',()=>{
 const s=state([request('a',[quote('q1','Acme',null)],'q1'),request('b',[quote('q2','Acme',{...check,selectedAbn:'00000000000'})],'q2')]);
 const rows=supplierRegister(s);assert.equal(rows.length,2);for(const row of rows){assert.equal(row.paid,0);assert.equal(row.outstanding,0);assert.equal(row.abn,'');}
});
test('Selection automatically persists a supplier and retains the relationship after request editing',()=>{
 const s={business:{projects:[],requests:[]}},p=saveProject(s,{name:'Site',pm:'taylor',director:'sam'},'alex');
 const r=createBusinessRequest(s,{kind:'service',payingEntity:'Test Development Pty Ltd',title:'Survey',background:'Scope',approach:'Report',amount:100,projectId:p.id,notifyCustomer:false},'taylor');
 actBusiness(s,r.id,'taylor','submit');actBusiness(s,r.id,'sam','approve');actBusiness(s,r.id,'jamie','approve');
 actBusiness(s,r.id,'taylor','source',{quotes:[quote('q','Acme'),quote('q2','Not chosen',null)],selectedIndex:0,reason:'Suitable'});
 assert.equal(s.business.suppliers.length,1);assert.equal(s.business.suppliers[0].name,'Acme');
 actBusiness(s,r.id,'taylor','withdraw',{reason:'Change scope'});updateBusinessRequest(s,r.id,{...r,amount:120},'taylor');
 const rows=supplierRegister(s);assert.equal(rows.length,1);assert.equal(rows[0].engagements.length,0);assert.equal(rows[0].selections.length,1);assert.equal(rows[0].outstanding,0);
});
test('Profile edits are permission checked, persist through commands and cannot replace ABN or payments',()=>{
 const s=state([request('a',[quote('q','Acme')],'q')]),id=supplierRegister(s)[0].id;
 assert.throws(()=>saveSupplierProfile(s,'taylor',{id,data:{}}),/Only Admin and Finance/);
 assert.throws(()=>saveSupplierProfile(s,'alex',{id:'unknown',data:{}}),/Choose a supplier/);
 assert.throws(()=>saveSupplierProfile(s,'alex',{id,data:{email:'invalid'}}),/valid contact email/);
 applyCommand(s,'jamie',{operation:'supplier-profile',id,data:{contact:'Accounts',email:'accounts@example.invalid',paymentTerms:'30 days',notes:'Use purchase reference',abn:'fake',payments:[{status:'Paid',amount:999}]}});
 const row=supplierRegister(s)[0];assert.equal(row.contact,'Accounts');assert.equal(row.abn,'51824753556');assert.equal(row.paid,0);assert.equal(row.selections.length,1);assert.equal(row.history.length,1);
});
test('Repeated selection is idempotent and the latest ABN warning stays visible',()=>{
 const r=request('a',[quote('q','Acme')],'q'),s=state([r]);recordSupplierSelection(s,r,r.quotes[0],'taylor');recordSupplierSelection(s,r,r.quotes[0],'taylor');
 r.quotes[0].abnCheck={...check,status:'review',checkedAt:'2026-11-02T00:00:00Z',warnings:['Review supplier identity']};
 assert.equal(supplierRegister(s)[0].selections.length,1);assert.equal(supplierRegister(s)[0].abnStatus,'Needs review');
});
