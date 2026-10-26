// Isolated browser fixture: synthetic data only, never sends email or touches .local/.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {initialState} from '../app/domain.mjs';
import {saveCustomer} from '../app/customer-domain.mjs';
import {saveProject,createBusinessRequest,actBusiness} from '../app/business.mjs';
import {provisionAccounts} from '../server/auth.mjs';
import {openWorkspace} from '../server/workspace.mjs';
import {localCustomerBackend} from '../server/customer-local.mjs';
import {createWorkspaceServer} from '../server.mjs';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bow-customer-preview-'));await provisionAccounts(dir,'browser-test-password');
const state=initialState();state.requests=[];state.business={projects:[],requests:[]};
const c=saveCustomer(state,{name:'Northfield Energy',contact:'Alex Client',email:'northfield@example.invalid'},'alex');
const p=saveProject(state,{name:'Northfield — Site upgrade',pm:'taylor',director:'sam',threshold:10000,customerId:c.id},'alex');
const p2=saveProject(state,{name:'Northfield — Grid connection',pm:'pm-b',director:'director-b',threshold:10000,customerId:c.id},'alex');
for(const [title,amount,completed] of [['Engineering site survey',8500,false],['Geotechnical assessment',6200,true]]){const r=createBusinessRequest(state,{kind:'service',projectId:p.id,title,amount,background:'Prepare the site for the proposed energy installation.',purpose:'Confirm ground conditions and equipment locations before detailed design.',approach:'A qualified engineer will survey the site and prepare a findings report.',attachments:[]},'taylor');actBusiness(state,r.id,'taylor','submit');if(completed){r.customerReview.status='Approved';r.stage='Completed';r.customerCompletion={summary:'The geotechnical assessment is complete. The findings and recommendations are available below.',files:[{name:'Assessment-summary.txt',data:'data:text/plain;base64,'+Buffer.from('Synthetic completion report.').toString('base64')}],publishedAt:new Date().toISOString()};}}
const c2=saveCustomer(state,{name:'Other customer',email:'other@example.invalid'},'alex');saveProject(state,{name:'Hidden customer project',pm:'taylor',director:'sam',threshold:10000,customerId:c2.id},'alex');
await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({revision:1,imported:true,state}),{mode:0o600});
const workspace=await openWorkspace(dir),backend=await localCustomerBackend(dir,workspace),link=await backend.issue(c,900000);
await fs.mkdir('evidence/business',{recursive:true});await fs.writeFile('evidence/business/customer-preview.json',JSON.stringify({url:'http://127.0.0.1:4187/#access='+link.token,dir}),{mode:0o600});
const server=await createWorkspaceServer({dataDir:dir,mailEnv:{}});server.listen(4187,'127.0.0.1',()=>console.log('Synthetic customer preview running on http://127.0.0.1:4187'));
process.on('SIGINT',()=>server.close(async()=>{await fs.rm(dir,{recursive:true,force:true});process.exit();}));
