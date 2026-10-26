import {cloudCustomerBackend} from './customer.mjs';
import {mailConfigured,reconcileCustomerMail,flushCustomerMail,issueCustomerLink,portalRead,portalDecision} from '../server/customer-service.mjs';
import {customerFiles} from '../app/customer-domain.mjs';
import {Container} from '@cloudflare/containers';
import {authenticated,login,logout,rateLimit,cookie} from './auth.mjs';
import {json,readJson,sameOrigin,fail} from './http.mjs';
import {readWorkspace,command} from './workspace.mjs';
import {checkContract} from './abn.mjs';
import {downloadFile} from './files.mjs';
export class InvoiceOCR extends Container {defaultPort=8080;sleepAfter='2m';enableInternet=false;}
async function syncMail(env){const backend=cloudCustomerBackend(env);await reconcileCustomerMail(backend,env);await flushCustomerMail(backend,env);}
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
  const user=await authenticated(request,env);
  if(p==='/api/auth/me'&&request.method==='GET')return json({user});
  if(user.role==='Customer'){
   const backend=cloudCustomerBackend(env);
   if(p==='/api/customer/workspace'&&request.method==='GET')return json(portalRead(await backend.read(),user.id));
   if(p==='/api/customer/decision'&&request.method==='POST')return json(await portalDecision(backend,user.id,await readJson(request,8192)));
   const f=/^\/api\/files\/([a-f0-9-]{36})$/.exec(p);
   if(f&&['GET','HEAD'].includes(request.method)){const record=await backend.read();let allowed=false;try{allowed=customerFiles(record.state,user.id).some(v=>v.data===p);}catch{}if(!allowed)fail(403,'Document is not shared with your customer account.');return downloadFile(request,env,user,f[1]);}
   fail(403,'Customer accounts cannot access internal workspace data.');
  }
  if(p.startsWith('/api/customer/')){
   if(user.role!=='Admin')fail(403,'Only Admin can manage customer access.');const backend=cloudCustomerBackend(env);
   if(p==='/api/customer/admin'&&request.method==='GET'){await reconcileCustomerMail(backend,env);return json({configured:mailConfigured(env),mail:await backend.list()});}
   if(p==='/api/customer/invite'&&request.method==='POST'){const input=await readJson(request,4096),{state}=await backend.read(),c=state.business.customers?.find(c=>c.id===input.id&&c.active);if(!c)fail(400,'Choose an active customer.');await issueCustomerLink(backend,env,c.email,{invite:true});ctx.waitUntil(flushCustomerMail(backend,env));return json({ok:true,configured:mailConfigured(env)});}
   if(p==='/api/customer/retry'&&request.method==='POST'){await backend.retry((await readJson(request,4096)).id);ctx.waitUntil(flushCustomerMail(backend,env));return json({ok:true});}
   fail(404,'Not found.');
  }
  if(p==='/api/workspace'&&request.method==='GET')return json(await readWorkspace(env,user.id));
  if(p==='/api/workspace/command'&&request.method==='POST'){
   await rateLimit(env,'commands:'+user.id,120,60000);
   try{const result=await command(env,user.id,await readJson(request));ctx.waitUntil(syncMail(env));return json(result);}catch(e){if(!e.status)e.status=400;throw e;}
  }
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
 async fetch(request,env,ctx){try{return await handle(request,env,ctx);}catch(e){if(!e.status)console.error('Request failed',e.message);return json({error:e.status?e.message:'The request could not be completed.'},e.status||500);}},
 async scheduled(event,env){await syncMail(env);await env.DB.prepare('DELETE FROM customer_links WHERE expires_at<=?').bind(Date.now()).run();await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(Date.now()),env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<=?').bind(Date.now())]);const rows=await env.DB.prepare('SELECT id,object_key FROM files WHERE committed=0 AND created_at<? LIMIT 50').bind(Date.now()-86400000).all();for(const row of rows.results){await env.FILES.delete(row.object_key);await env.DB.prepare('DELETE FROM files WHERE id=? AND committed=0').bind(row.id).run();}}
};
