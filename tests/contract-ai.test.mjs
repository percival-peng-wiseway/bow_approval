import {signing,bankVerification} from './support/service-v2.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {analyzeContract,contractSchema,verifyContractChecks} from '../server/contract-ai.mjs';
import {openAISettings} from '../server/ai-settings.mjs';
import {initialState} from '../app/domain.mjs';
import {saveProject,createBusinessRequest,actBusiness} from '../app/business.mjs';
import {createWorkspaceServer} from '../server.mjs';
import {provisionAccounts} from '../server/auth.mjs';
const file={name:'contract.txt',data:'data:text/plain;base64,U3ludGhldGljIGNvbnRyYWN0',size:18};
const report=()=>({...Object.fromEntries(Object.keys(contractSchema.properties).map(k=>[k,contractSchema.properties[k].type==='array'?[]:''])),supplierName:'Test supplier',supplierAbn:'51824753556',paymentTerms:'30 days',totalAmount:'AUD 1,000 including GST',sources:[{field:'paymentTerms',source:'contract.txt: 30 days'}],attentionPoints:[{severity:'Medium',topic:'Acceptance',finding:'No acceptance procedure found',suggestion:'Confirm acceptance criteria',source:'contract.txt: clause not found'}]});
function fixture(){const s=initialState();s.requests=[];s.business={projects:[],requests:[]};const p=saveProject(s,{name:'Synthetic contract project',pm:'taylor',director:'sam'},'alex'),r=createBusinessRequest(s,{kind:'service',payingEntity:'Test Development Pty Ltd',projectId:p.id,title:'Site survey',background:'Site works',approach:'Report',amount:1000},'pm-b');delete r.invoiceFlowVersion;const act=(actor,action,data)=>actBusiness(s,r.id,actor,action,data);act('pm-b','submit');act('sam','approve');act('jamie','approve');act('pm-b','source',{quotes:[{supplier:'Test supplier',amount:1000,quoteFiles:[file]}],selectedIndex:0,reason:'Fit'});act('sam','approve');act('jamie','approve');return {s,r,act};}
const memory=()=>{const entries=new Map();return {save:async r=>entries.set(r.id,structuredClone(r)),load:async id=>entries.get(id)};};
const response=()=>({ok:true,json:async()=>({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(report())}]}]})});
const settings={model:'gpt-6-luna',enabled:true,apiKey:'sk-test-only-not-a-real-key'};
test('Luna analysis uses structured output, no storage and only the requester after approval; missing configuration never fabricates results',async()=>{
 const {s,r}=fixture(),store=memory();let body,calls=0;const fetcher=async(url,options)=>{calls++;assert.equal(url,'https://api.openai.com/v1/responses');body=JSON.parse(options.body);return response();};
 await assert.rejects(analyzeContract(s,'taylor',{requestId:r.id,files:[file]},settings,store,fetcher),/requester/);
 await assert.rejects(analyzeContract(s,'pm-b',{requestId:r.id,files:[file]},{},store,fetcher),/not configured/);assert.equal(calls,0);
 const result=await analyzeContract(s,'pm-b',{requestId:r.id,files:[file]},settings,store,fetcher);assert.equal(result.report.paymentTerms,'30 days');assert.equal(body.model,'gpt-6-luna');assert.equal(body.store,false);assert.equal(body.text.format.strict,true);assert.match(body.instructions,/untrusted/);assert.ok(!JSON.stringify(result).includes(settings.apiKey));
 const input={operation:'action',action:'contract',id:r.id,data:{files:[file],analysisId:result.id,analysis:{forged:true}}};await verifyContractChecks(input,'pm-b',store);assert.equal(input.data.analysis.id,result.id);assert.equal(input.data.analysis.forged,undefined);
 await assert.rejects(verifyContractChecks({...input,data:{files:[{...file,data:file.data+'YQ=='}],analysisId:result.id}},'pm-b',store),/no longer matches/);
 await assert.rejects(verifyContractChecks({...input,id:'other',data:{files:[file],analysisId:result.id}},'pm-b',store),/no longer matches/);
 await assert.rejects(verifyContractChecks({...input,data:{files:[file],analysisId:result.id}},'alex',store),/no longer matches/);
 const forged={...input,data:{files:[file],analysis:{forged:true},abnCheck:{status:'checked'}}};await verifyContractChecks(forged,'pm-b',store);assert.equal(forged.data.analysis,undefined);assert.equal(forged.data.abnCheck,undefined);
});
test('Failed, refused and malformed AI output does not create a report or expose API errors',async()=>{
 const {s,r}=fixture();for(const fake of [{ok:false,status:401,json:async()=>({error:settings.apiKey})},{ok:true,json:async()=>({status:'incomplete',output:[]})},{ok:true,json:async()=>({status:'completed',output:[{content:[{type:'output_text',text:'{}'}]}]})}]){
 const store=memory();await assert.rejects(analyzeContract(s,'pm-b',{requestId:r.id,files:[file]},settings,store,async()=>fake),e=>!e.message.includes(settings.apiKey));}
});
test('AI settings remain private, metadata only and blank key keeps the stored key',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bow-ai-settings-'));try{const store=await openAISettings(dir);assert.equal((await store.public()).configured,false);const metadata=await store.save(settings);assert.equal(metadata.configured,true);assert.ok(!JSON.stringify(metadata).includes(settings.apiKey));assert.equal((await fs.stat(path.join(dir,'ai-settings.json'))).mode&0o777,0o600);await store.save({model:'gpt-6-luna',enabled:true,apiKey:''});assert.equal((await store.read()).apiKey,settings.apiKey);await store.save({model:'gpt-6-luna',clearKey:true});assert.equal((await store.public()).configured,false);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('Local API end-to-end: admin settings, requester analysis and draft, Finance return and approval, then payment plan',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'bow-contract-api-'));let server;try{
 const {s,r}=fixture();await provisionAccounts(dir,'contract-test-password');await fs.writeFile(path.join(dir,'workspace.json'),JSON.stringify({revision:1,imported:true,state:s}));let calls=0;server=await createWorkspaceServer({dataDir:dir,mailEnv:{},aiFetch:async()=>{calls++;return response();}});server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;
 const call=async(route,cookie,data)=>{const res=await fetch(base+route,{method:data?'POST':'GET',headers:{...(cookie?{Cookie:cookie}:{}),...(data?{Origin:base,'Content-Type':'application/json','X-Requested-With':'ApprovalWorkspace'}:{})},body:data?JSON.stringify(data):undefined});return {status:res.status,body:await res.json(),cookie:res.headers.get('set-cookie')};};
 const login=async name=>(await call('/api/auth/login',null,{username:name,password:'contract-test-password'})).cookie;
 const admin=await login('Kate'),pm=await login('Nidhi Pandey'),projectPM=await login('Hassan Kassem'),finance=await login('Lewis');
 assert.equal((await call('/api/settings/ai',pm)).status,403);assert.equal((await call('/api/settings/ai',finance,settings)).status,403);
 assert.equal((await call('/api/contracts/analyze',pm,{requestId:r.id,files:[file]})).status,503);assert.equal(calls,0);
 const saved=await call('/api/settings/ai',admin,settings);assert.equal(saved.status,200);assert.equal(saved.body.configured,true);assert.ok(!JSON.stringify(saved.body).includes(settings.apiKey));assert.ok(!(await call('/api/workspace',admin)).body.state.aiSettings);
 assert.equal((await call('/api/contracts/analyze',projectPM,{requestId:r.id,files:[file]})).status,403);
 assert.equal((await call('/api/contracts/analyze',finance,{requestId:r.id,files:[file]})).status,403);
 const ai=await call('/api/contracts/analyze',pm,{requestId:r.id,files:[file]});assert.equal(ai.status,200);assert.equal(calls,1);
 let revision=1;const cmd=async(cookie,action,data)=>{const out=await call('/api/workspace/command',cookie,{revision,operation:'action',id:r.id,action,data});if(out.status===200)revision=out.body.revision;return out;};
 let out=await cmd(pm,'contract',{files:[file],amount:1000,abn:'51824753556',analysisId:ai.body.id,submit:false});assert.equal(out.status,200);assert.equal(out.body.result.serviceContract.analysis.id,ai.body.id);assert.equal(out.body.result.stage,'Contract preparation');
 out=await cmd(pm,'contract',{files:[file],amount:1000,analysisId:ai.body.id,submit:true});assert.equal(out.body.result.stage,'Contract review');assert.equal((await cmd(finance,'plan',{payments:[]})).status,400);
 out=await cmd(finance,'return',{reason:'Confirm acceptance terms'});assert.equal(out.body.result.stage,'Contract preparation');
 out=await cmd(pm,'contract',{files:[file],amount:1000,notes:'Confirmed',submit:true});assert.equal(out.body.result.serviceContract.analysis,null);
 out=await cmd(finance,'approve');assert.equal(out.body.result.stage,'Contract signing');assert.equal((await cmd(pm,'sign-contract',signing([file]))).status,200);assert.equal((await cmd(finance,'verify-bank',bankVerification)).status,200);out=await cmd(finance,'plan',{payments:[{kind:'Final',label:'Final payment',amount:1000,dueDate:'2026-12-01',method:'Bank transfer',requirements:'Invoice and acceptance'}]});assert.equal(out.status,200);assert.equal(out.body.result.stage,'Payment documents');
 const disk=JSON.parse(await fs.readFile(path.join(dir,'workspace.json'),'utf8'));assert.ok(!JSON.stringify(disk).includes(settings.apiKey));assert.equal(disk.state.business.requests[0].serviceContract.approvedBy,'jamie');
 }finally{if(server?.listening)await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});}
});
