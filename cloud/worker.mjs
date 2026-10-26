import {Container} from '@cloudflare/containers';
import {authenticated,login,logout,rateLimit} from './auth.mjs';
import {json,readJson,sameOrigin,fail} from './http.mjs';
import {readWorkspace,command} from './workspace.mjs';
import {checkContract} from './abn.mjs';
import {downloadFile} from './files.mjs';
export class InvoiceOCR extends Container {defaultPort=8080;sleepAfter='2m';enableInternet=false;}
async function handle(request,env){
 const url=new URL(request.url),p=url.pathname;
 if(p==='/api/health'&&request.method==='GET')return json({ok:true,environment:env.APP_ENV||'prod'});
 if(p.startsWith('/api/')){
  if(!['GET','HEAD','POST'].includes(request.method))fail(405,'Method not allowed.');
  if(request.method==='POST')sameOrigin(request);
  if(p==='/api/auth/login'&&request.method==='POST'){const session=await login(request,env,await readJson(request,4096));return json({user:session.user},200,{'Set-Cookie':session.cookie});}
  if(p==='/api/auth/logout'&&request.method==='POST')return json({ok:true},200,{'Set-Cookie':await logout(request,env)});
  const user=await authenticated(request,env);
  if(p==='/api/auth/me'&&request.method==='GET')return json({user});
  if(p==='/api/workspace'&&request.method==='GET')return json(await readWorkspace(env,user.id));
  if(p==='/api/workspace/command'&&request.method==='POST'){
   await rateLimit(env,'commands:'+user.id,120,60000);
   try{return json(await command(env,user.id,await readJson(request)));}catch(e){if(!e.status)e.status=400;throw e;}
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
 async fetch(request,env){try{return await handle(request,env);}catch(e){if(!e.status)console.error('Request failed',e.message);return json({error:e.status?e.message:'The request could not be completed.'},e.status||500);}},
 async scheduled(event,env){await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(Date.now()),env.DB.prepare('DELETE FROM rate_limits WHERE expires_at<=?').bind(Date.now())]);const rows=await env.DB.prepare('SELECT id,object_key FROM files WHERE committed=0 AND created_at<? LIMIT 50').bind(Date.now()-86400000).all();for(const row of rows.results){await env.FILES.delete(row.object_key);await env.DB.prepare('DELETE FROM files WHERE id=? AND committed=0').bind(row.id).run();}}
};
