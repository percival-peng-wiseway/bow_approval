import {readiness} from '../server/readiness.mjs';
import {runWithDirectory} from '../server/directory.mjs';
import {staffDirectory,staffAccounts,saveStaff,changePassword} from './accounts.mjs';
import {visibleRecord} from '../server/access.mjs';
import {delegatedActor} from '../server/delegation.mjs';
import {cloudAIMetadata,saveCloudAISettings,analyzeCloudContract} from './ai.mjs';
import {checkExpenseSupplier} from '../server/expense-supplier.mjs';
import {cloudCustomerBackend} from './customer.mjs';
import {mailConfigured,reconcileCustomerMail,reconcileStaffMail,flushCustomerMail,issueCustomerLink,portalRead,adminCustomerPreview,portalDecision,inviteProjectCustomer} from '../server/customer-service.mjs';
import {customerFiles} from '../app/customer-domain.mjs';
import {Container} from '@cloudflare/containers';
import {authenticated,login,logout,rateLimit,cookie,setCustomerPassword,validateCustomerPassword} from './auth.mjs';
import {json,readJson,sameOrigin,fail} from './http.mjs';
import {readWorkspace,command} from './workspace.mjs';
import {checkContract,checkInvoice,cloudCheckStore} from './abn.mjs';
import {downloadFile} from './files.mjs';
export class InvoiceOCR extends Container {defaultPort=8080;sleepAfter='2m';enableInternet=false;}
async function syncMail(env){const backend=cloudCustomerBackend(env);await reconcileCustomerMail(backend,env);await reconcileStaffMail(backend,env);await flushCustomerMail(backend,env);}
async function handle(request,env,ctx){
 const url=new URL(request.url),p=url.pathname;
 if(p==='/api/health'&&request.method==='GET')return json({ok:true,environment:env.APP_ENV||'prod'});
 if(p.startsWith('/api/')){
  if(!['GET','HEAD','POST'].includes(request.method))fail(405,'Method not allowed.');
  if(request.method==='POST')sameOrigin(request);
  if(p==='/api/customer/access'&&request.method==='POST'){
   await rateLimit(env,'customer-access:'+request.headers.get('CF-Connecting-IP'),10,900000);
   const input=await readJson(request,4096),backend=cloudCustomerBackend(env);
   if(input.token){const session=await backend.redeem(input.token);return json({user:session.user},200,{'Set-Cookie':cookie(request,session.token,43200)});}
   if(!mailConfigured(env))fail(503,'Customer email sign-in is not configured yet. Contact the project team.');
   await issueCustomerLink(backend,env,input.email);ctx.waitUntil(flushCustomerMail(backend,env));return json({ok:true});
  }
  if(p==='/api/auth/login'&&request.method==='POST'){const session=await login(request,env,await readJson(request,4096));return json({user:session.user},200,{'Set-Cookie':session.cookie});}
  if(p==='/api/auth/logout'&&request.method==='POST')return json({ok:true},200,{'Set-Cookie':await logout(request,env)});
  const authenticatedUser=await authenticated(request,env);
  let user=authenticatedUser;
  if(p==='/api/auth/me'&&request.method==='GET')return json({user,directory:user.role==='Customer'?undefined:await staffDirectory(env)});
  if(p==='/api/auth/password'&&request.method==='POST'){await rateLimit(env,'password:'+user.id,10,900000);const input=await readJson(request,4096);return json(await changePassword(env,user.id,input.currentPassword,input.password));}
  if(user.mustChangePassword)fail(403,'Change your temporary password before continuing.');
  if(p==='/api/settings/readiness'&&request.method==='GET'){if(user.role!=='Admin')fail(403,'Only Admin can view readiness.');return json(readiness({accounts:await staffAccounts(env),ai:await cloudAIMetadata(env),env,cloud:true}));}
  if(p==='/api/settings/accounts'){
   if(user.role!=='Admin'||request.headers.has('X-Act-As'))fail(403,'Only a signed-in Admin can manage staff accounts.');
   return json(request.method==='GET'?{accounts:await staffAccounts(env)}:await saveStaff(env,user.id,await readJson(request,4096),(await readWorkspace(env,user.id)).state));
  }
  user=delegatedActor(authenticatedUser,request.headers.get('X-Act-As'));
  const performedBy=user.id!==authenticatedUser.id?authenticatedUser.id:null;
  if(user.role==='Customer'){
   const backend=cloudCustomerBackend(env);
   if(p==='/api/customer/workspace'&&request.method==='GET')return json(portalRead(await backend.read(),user.id));
   if(p==='/api/customer/decision'&&request.method==='POST')return json(await portalDecision(backend,user.id,await readJson(request,8192)));
   const f=/^\/api\/files\/([a-f0-9-]{36})$/.exec(p);
   if(f&&['GET','HEAD'].includes(request.method)){const record=await backend.read();let allowed=false;try{allowed=customerFiles(record.state,user.id).some(v=>v.data===p);}catch{}if(!allowed)fail(403,'Document is not shared with your customer account.');return downloadFile(request,env,user,f[1]);}
   fail(403,'Customer accounts cannot access internal workspace data.');
  }
  if(p==='/api/notifications/retry'&&request.method==='POST'){const input=await readJson(request,4096),backend=cloudCustomerBackend(env),mail=await backend.mail(input.id);if(mail?.staffId!==user.id)fail(403,'This notification is not yours.');await backend.retry(input.id);ctx.waitUntil(syncMail(env));return json({ok:true});}
  if(p==='/api/notifications'&&request.method==='GET')return json({configured:mailConfigured(env),mail:(await cloudCustomerBackend(env).list()).filter(m=>m.staffId===user.id)});
  if(p.startsWith('/api/customer/')){
   if(user.role!=='Admin')fail(403,'Only Admin can manage customer access.');const backend=cloudCustomerBackend(env);
   if(p==='/api/customer/preview'&&request.method==='GET')return json(adminCustomerPreview(await backend.read(),user.id,url.searchParams.get('customerId')));
   if(p==='/api/customer/project-invite'&&request.method==='POST'){const input=await readJson(request,8192),result=await inviteProjectCustomer(backend,{validate:(c,v)=>validateCustomerPassword(env,c,v),set:(c,v)=>setCustomerPassword(env,c,v)},user.id,input,env);ctx.waitUntil(flushCustomerMail(backend,env));return json({...result,configured:mailConfigured(env)});}
   if(p==='/api/customer/password'&&request.method==='POST'){const input=await readJson(request,4096),{state}=await backend.read(),c=state.business.customers?.find(c=>c.id===input.id&&c.active);if(!c)fail(400,'Choose an active customer.');return json(await setCustomerPassword(env,c,input));}
   if(p==='/api/customer/admin'&&request.method==='GET'){await reconcileCustomerMail(backend,env);return json({configured:mailConfigured(env),mail:await backend.list(),logins:(await env.DB.prepare("SELECT id,username FROM accounts WHERE role='Customer'").all()).results});}
   if(p==='/api/customer/invite'&&request.method==='POST'){const input=await readJson(request,4096),{state}=await backend.read(),c=state.business.customers?.find(c=>c.id===input.id&&c.active);if(!c)fail(400,'Choose an active customer.');await issueCustomerLink(backend,env,c.email,{invite:true});ctx.waitUntil(flushCustomerMail(backend,env));return json({ok:true,configured:mailConfigured(env)});}
   if(p==='/api/customer/retry'&&request.method==='POST'){await backend.retry((await readJson(request,4096)).id);ctx.waitUntil(flushCustomerMail(backend,env));return json({ok:true});}
   fail(404,'Not found.');
  }
  if(p==='/api/settings/ai'){if(user.role!=='Admin')fail(403,'Only Admin can manage AI settings.');return json(request.method==='GET'?await cloudAIMetadata(env):await saveCloudAISettings(env,await readJson(request,4096),user.id));}
  if(p==='/api/contracts/analyze'&&request.method==='POST'){await rateLimit(env,'contract-ai:'+user.id,2,60000);return json(await analyzeCloudContract(env,user.id,await readJson(request,5*1024*1024)));}
  if(p==='/api/workspace'&&request.method==='GET')return json(visibleRecord(await readWorkspace(env,user.id),user.id));
  if(p==='/api/workspace/command'&&request.method==='POST'){
   await rateLimit(env,'commands:'+user.id,120,60000);
   try{const result=await command(env,user.id,await readJson(request),{performedBy});ctx.waitUntil(syncMail(env));return json(visibleRecord(result,user.id));}catch(e){if(!e.status)e.status=400;throw e;}
  }
  if(p==='/api/expenses/check-abn'&&request.method==='POST'){await rateLimit(env,'abn:'+user.id,12,60000);return json(await checkExpenseSupplier(await readJson(request,4096),user.id,cloudCheckStore(env,user.id)));}
  if(p==='/api/invoices/check-abn'&&request.method==='POST'){await rateLimit(env,'abn:'+user.id,12,60000);return json(await checkInvoice(env,user.id,await readJson(request,5*1024*1024)));}
  if(p==='/api/contracts/check-abn'&&request.method==='POST'){await rateLimit(env,'abn:'+user.id,12,60000);return json(await checkContract(env,user.id,await readJson(request,5*1024*1024)));}
  const file=/^\/api\/files\/([a-f0-9-]{36})$/.exec(p);
  if(file&&['GET','HEAD'].includes(request.method))return downloadFile(request,env,user,file[1]);
  if(['/api/invoice/scan','/api/invoice/preview'].includes(p)&&request.method==='POST'){
   await rateLimit(env,'ocr:'+user.id,12,60000);
   const data=await readJson(request,Math.ceil(2*1024*1024*4/3)+4096);
   if(typeof data.name!=='string'||typeof data.data!=='string')fail(400,'Choose an invoice file.');
   try{
    const container=env.OCR.getByName('invoice-ocr');
    const response=await container.fetch(new Request('http://container'+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)}));
    return new Response(response.body,{status:response.status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
   }catch{fail(503,'Invoice scanning is temporarily unavailable. Try again shortly or enter the details manually.');}
  }
  fail(404,'Not found.');
 }
 if(!['GET','HEAD'].includes(request.method))fail(405,'Method not allowed.');
 // Only the prepared public folder is bound to ASSETS; no server code or private files are served.
 if(p!=='/'&&!/^\/app\/[a-zA-Z0-9_.-]+\.(?:mjs|css|png|svg|woff2?)$/.test(p))fail(404,'Not found.');
 const asset=await env.ASSETS.fetch(new Request(url,request));
 const headers=new Headers(asset.headers);headers.set('X-Content-Type-Options','nosniff');headers.set('Referrer-Policy','same-origin');headers.set('X-Frame-Options','DENY');
 if(p==='/')headers.set('Cache-Control','no-cache');
 return new Response(asset.body,{status:asset.status,headers});
}
export default {
 async fetch(request,env,ctx){try{return await runWithDirectory(new URL(request.url).pathname.startsWith('/api/')&&new URL(request.url).pathname!=='/api/health'?await staffDirectory(env):undefined,()=>handle(request,env,ctx));}catch(e){if(!e.status)console.error('Request failed',e.message);return json({error:e.status?e.message:'The request could not be completed.'},e.status||500);}},
 async scheduled(event,env){await runWithDirectory(await staffDirectory(env),()=>syncMail(env));await env.DB.prepare('DELETE FROM customer_links WHERE expires_at<=?').bind(Date.now()).run();await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(Date.now()),env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<=?').bind(Date.now())]);const rows=await env.DB.prepare('SELECT id,object_key FROM files WHERE committed=0 AND created_at<? LIMIT 50').bind(Date.now()-86400000).all();for(const row of rows.results){await env.FILES.delete(row.object_key);await env.DB.prepare('DELETE FROM files WHERE id=? AND committed=0').bind(row.id).run();}}
};
