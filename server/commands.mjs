import {saveProject,createBusinessRequest,updateBusinessRequest,actBusiness} from '../app/business.mjs';
export function applyCommand(state,actor,input){
 if(input.operation==='project'){
  if(!['taylor','pm-b'].includes(input.data?.pm)||!['sam','director-b','director-c'].includes(input.data?.director))throw new Error('Choose an active PM and Director.');
  return saveProject(state,input.data,actor);
 }
 if(input.operation==='request'){
  const result=input.id?updateBusinessRequest(state,input.id,input.data,actor):createBusinessRequest(state,input.data,actor);
  if(input.submit)actBusiness(state,result.id,actor,'submit');return result;
 }
 if(input.operation==='action')return actBusiness(state,input.id,actor,input.action,input.data);
 throw new Error('Unknown operation.');
}
