import test from 'node:test';
import assert from 'node:assert/strict';
import {saveProject,createBusinessRequest,actBusiness} from '../app/business.mjs';
import {homeGroups,nextTask,notificationItems,saveNotificationSettings} from '../app/workspace-insights.mjs';
import {filterWorkspaceRequests} from '../app/workspace-model.mjs';
import {reconcileStaffMail,flushCustomerMail} from '../server/customer-service.mjs';
const file={name:'receipt.txt',data:'data:text/plain;base64,YQ==',size:1};
const fixture=()=>{const s={},p=saveProject(s,{name:'Test project',pm:'taylor',director:'sam',threshold:10000},'alex'),r=createBusinessRequest(s,{kind:'reimbursement',projectId:p.id,title:'Travel',invoiceDate:'2026-11-01',amount:2500,attachments:[file]},'employee');actBusiness(s,r.id,'employee','submit');actBusiness(s,r.id,'taylor','approve');return {s,r};};
test('Director has a distinct actionable FYI task while Finance retains approval responsibility',()=>{
 const {s,r}=fixture();assert.equal(homeGroups(s,'sam').action[0].id,r.id);assert.match(nextTask(r,'sam'),/Acknowledge/);assert.equal(filterWorkspaceRequests([r],{actor:'sam',tab:'todo'}).length,1);
 const notice=notificationItems(s,'sam','2026-11-09')[0];assert.equal(notice.kind,'acknowledgement');
 actBusiness(s,r.id,'jamie','approve');assert.equal(notificationItems(s,'sam','2026-11-09')[0].id,notice.id);
 actBusiness(s,r.id,'sam','acknowledge');assert.equal(homeGroups(s,'sam').action.length,0);assert.equal(notificationItems(s,'sam','2026-11-09').length,0);assert.equal(r.stage,'Ready to pay');
});
test('FYI mail queues once per notice, has no delivery claim, and stale notices cancel',async()=>{
 const {s,r}=fixture(),mail=new Map();saveNotificationSettings(s,'sam',{data:{email:'director@example.invalid',enabled:true}});
 const backend={read:async()=>({state:s}),enqueue:async m=>{if(!mail.has(m.id))mail.set(m.id,m);},pending:async()=>[...mail.values()].filter(m=>m.status==='queued'),claim:async id=>mail.get(id),finish:async(m,result)=>Object.assign(mail.get(m.id),result)};
 await reconcileStaffMail(backend,{});await reconcileStaffMail(backend,{});assert.equal(mail.size,1);assert.equal([...mail.values()][0].status,'queued');assert.match([...mail.values()][0].subject,/acknowledgement/);assert.match([...mail.values()][0].text,/not an approval/);
 actBusiness(s,r.id,'sam','acknowledge');let sends=0;await flushCustomerMail(backend,{},async()=>{sends++;return {status:'accepted'};});assert.equal(sends,0);assert.equal([...mail.values()][0].status,'cancelled');
});
