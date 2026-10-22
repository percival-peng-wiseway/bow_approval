import fs from 'node:fs/promises';
import path from 'node:path';
import {initialState} from '../app/domain.mjs';
import {ensureBusiness} from '../app/business.mjs';
import {applyCommand} from './commands.mjs';
export async function openWorkspace(dir){
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 const file=path.join(dir,'workspace.json');let record;
 try{record=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;record={revision:0,imported:false,state:initialState()};ensureBusiness(record.state);}
 let queue=Promise.resolve();
 const serialize=fn=>{const next=queue.then(fn);queue=next.catch(()=>{});return next;};
 const view=actor=>({state:{...structuredClone(record.state),actor},revision:record.revision,canImport:record.revision===0&&!record.imported,imported:record.imported});
 const save=async next=>{const tmp=file+'.tmp';await fs.writeFile(tmp,JSON.stringify(next),{mode:0o600});await fs.rename(tmp,file);record=next;};
 return {read:view,command:(actor,input)=>serialize(async()=>{
  if(input.revision!==record.revision)throw Object.assign(new Error('The workspace changed. Review the latest data and try again.'),{status:409});
  const next=structuredClone(record);let result;
  if(input.operation==='import'){
   if(actor!=='alex')throw Object.assign(new Error('Only Kate can import the existing workspace.'),{status:403});
   if(record.revision!==0||record.imported)throw Object.assign(new Error('The shared workspace already contains data. The browser copy has been preserved.'),{status:409});
   const legacy=input.data;
   if(!Array.isArray(legacy?.requests)||!legacy.workflows||!Array.isArray(legacy?.business?.projects)||!Array.isArray(legacy?.business?.requests))throw new Error('Invalid browser workspace.');
   await fs.writeFile(path.join(dir,'browser-import.json'),JSON.stringify(legacy),{flag:'wx',mode:0o600}).catch(e=>{if(e.code!=='EEXIST')throw e;});
   next.state=structuredClone(legacy);next.imported=true;result={imported:true};
  }else result=applyCommand(next.state,actor,input);
  next.revision++;delete next.state.actor;await save(next);return {...view(actor),result};
 })};
}
