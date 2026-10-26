// Public, synthetic preview. This module never reads or writes a real workspace.
import {saveCustomer,customerView,customerDecision} from './customer-domain.mjs';
import {saveProject,createBusinessRequest,actBusiness} from './business.mjs';

export function createCustomerDemo(){
 const state={business:{customers:[],projects:[],requests:[]}};
 const customer=saveCustomer(state,{name:'Northfield Energy · Demo',contact:'Demo customer',email:'demo@example.invalid'},'alex');
 const project=saveProject(state,{name:'Site upgrade',pm:'taylor',director:'sam',threshold:10000,customerId:customer.id},'alex');
 saveProject(state,{name:'Grid connection',pm:'pm-b',director:'director-b',threshold:10000,customerId:customer.id},'alex');
 for(const [title,amount,completed] of [['Engineering site survey',8500,false],['Geotechnical assessment',6200,true]]){
  const r=createBusinessRequest(state,{kind:'service',projectId:project.id,title,amount,background:'Prepare the site for a proposed energy installation.',purpose:'Confirm site conditions before detailed design.',approach:'An engineer will visit the site and prepare a findings report.',attachments:[]},'taylor');
  actBusiness(state,r.id,'taylor','submit');
  if(completed){customerDecision(state,customer.id,{id:r.id,reviewId:r.customerReview.id,decision:'approve'});r.stage='Completed';r.customerCompletion={summary:'The assessment is complete. View the sample handover document below.',files:[{name:'Sample-handover.txt',data:'data:text/plain;base64,U2FtcGxlIGNvbXBsZXRpb24gcmVwb3J0LiBObyByZWFsIHByb2plY3QgZGF0YS4=',size:47}],publishedAt:new Date().toISOString()};}
 }
 let revision=1;
 return {
  read:()=>({...customerView(state,customer.id),revision}),
  decide(input){if(input.revision!==revision)throw new Error('This preview has changed. Refresh the page.');customerDecision(state,customer.id,input);revision++;}
 };
}
