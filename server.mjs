import {readiness} from './server/readiness.mjs';
import {directoryContext} from './server/directory.mjs';
import {visibleRecord} from './server/access.mjs';
import {checkExpenseSupplier} from './server/expense-supplier.mjs';
import {openAISettings} from './server/ai-settings.mjs';
import {delegatedActor} from './server/delegation.mjs';
import {analyzeContract,verifyContractChecks} from './server/contract-ai.mjs';
import {localCustomerBackend} from './server/customer-local.mjs';
import {mailConfigured,reconcileCustomerMail,reconcileStaffMail,flushCustomerMail,issueCustomerLink,portalRead,adminCustomerPreview,portalDecision,inviteProjectCustomer} from './server/customer-service.mjs';
import {localCheckStore,checkLocalContract,checkLocalInvoice,verifySourceChecks} from './server/abn-local.mjs';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openAuth} from './server/auth.mjs';
import {openWorkspace} from './server/workspace.mjs';
import {scanInvoice,MAX_FILE_BYTES} from './ocr/service.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.json':'application/json','.md':'text/plain; charset=utf-8'};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
export async function createWorkspaceServer({dataDir=process.env.APP_DATA_DIR||path.join(root,'.local'),mailEnv=process.env,sendMail,aiFetch=fetch}={}){
const checks=await localCheckStore(dataDir);
const aiSettings=await openAISettings(dataDir);let analyzing=new Set();
const workspace=await openWorkspace(dataDir,{verifyCommand:(actor,input)=>verifyContractChecks(input,actor,checks)});
const auth=await openAuth(dataDir,{customerById:id=>workspace.read(id).state.business.customers?.find(c=>c.id===id)});
const portal=await localCustomerBackend(dataDir,workspace,{passwordVersion:id=>auth.passwordVersion(id)});
const mailSettings={EMAIL_FROM:'BOW OA <notifications@wiseway.ai>',...mailEnv,PUBLIC_APP_URL:mailEnv.PUBLIC_APP_URL||'http://127.0.0.1:4185'};
let mailQueue=Promise.resolve();const syncMail=()=>{mailQueue=mailQueue.catch(()=>{}).then(()=>directoryContext.run(auth.directory(),async()=>{await reconcileCustomerMail(portal,mailSettings);await reconcileStaffMail(portal,mailSettings);await flushCustomerMail(portal,mailSettings,sendMail);}));return mailQueue;};
const accessLimits=new Map();const limitAccess=key=>{const current=accessLimits.get(key)||{count:0,until:Date.now()+900000};if(current.until<Date.now()){current.count=0;current.until=Date.now()+900000;}current.count++;accessLimits.set(key,current);if(current.count>10)throw Object.assign(new Error('Too many attempts. Try again later.'),{status:429});};
let activeScans=0;
const readBody=async(req,limit=12*1024*1024)=>{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(new Error('Request is too large.'),{status:413});chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw Object.assign(new Error('Invalid request.'),{status:400});}};
const server=http.createServer(async(req,res)=>{
  try{
    directoryContext.enterWith(auth.directory());
    const host=new URL('http://'+req.headers.host);
    if(!['127.0.0.1','localhost'].includes(host.hostname))return json(res,403,{error:'Local access only.'});
    const url=new URL(req.url,host);
    if(url.pathname.startsWith('/api/')){
      if(!['GET','POST'].includes(req.method))return json(res,405,{error:'Method not allowed.'});
      if(req.method==='POST'&&(req.headers.origin!==host.origin||req.headers['x-requested-with']!=='ApprovalWorkspace'||!req.headers['content-type']?.startsWith('application/json')))return json(res,403,{error:'Open this action in the workspace.'});
      if(url.pathname==='/api/auth/login'&&req.method==='POST'){
        const input=await readBody(req,4096);const session=await auth.login(input.username,input.password,req.socket.remoteAddress,input.audience);res.setHeader('Set-Cookie',session.cookie);return json(res,200,{user:session.user});
      }
      if(url.pathname==='/api/customer/access'&&req.method==='POST'){
        limitAccess(req.socket.remoteAddress);const input=await readBody(req,4096);
        if(input.token){const user=await portal.redeem(input.token),session=auth.createSession(user);res.setHeader('Set-Cookie',session.cookie);return json(res,200,{user});}
        if(!mailConfigured(mailSettings)&&!sendMail)return json(res,503,{error:'Customer email sign-in is not configured yet. Contact the project team.'});
        await issueCustomerLink(portal,mailSettings,input.email);await syncMail();return json(res,200,{ok:true});
      }
      const authenticated=auth.user(req);
      if(!authenticated)return json(res,401,{error:'Please sign in to continue.'});
      if(url.pathname==='/api/auth/me'&&req.method==='GET')return json(res,200,{user:authenticated,directory:authenticated.role==='Customer'?undefined:auth.directory()});
      if(url.pathname==='/api/auth/logout'&&req.method==='POST'){res.setHeader('Set-Cookie',auth.logout(req));return json(res,200,{ok:true});}
      if(url.pathname==='/api/auth/password'&&req.method==='POST'){limitAccess('password:'+authenticated.id);const input=await readBody(req,4096);return json(res,200,await auth.changePassword(authenticated.id,input.currentPassword,input.password));}
      if(authenticated.mustChangePassword)return json(res,403,{error:'Change your temporary password before continuing.',code:'PASSWORD_CHANGE_REQUIRED'});
      if(url.pathname==='/api/settings/readiness'&&req.method==='GET'){if(authenticated.role!=='Admin')return json(res,403,{error:'Only Admin can view readiness.'});return json(res,200,readiness({accounts:auth.staffAccounts(),ai:await aiSettings.public(),env:mailSettings,abnConfigured:checks.configured}));}
      if(url.pathname==='/api/settings/accounts'){
       if(authenticated.role!=='Admin'||req.headers['x-act-as'])return json(res,403,{error:'Only a signed-in Admin can manage staff accounts.'});
       if(req.method==='GET')return json(res,200,{accounts:auth.staffAccounts()});
       return json(res,200,await auth.saveStaff(authenticated.id,await readBody(req,4096),workspace.read(authenticated.id).state));
      }
      const actor=delegatedActor(authenticated,req.headers['x-act-as']);
      const performedBy=actor.id!==authenticated.id?authenticated.id:null;
      if(performedBy&&req.method==='POST'){
        await fs.appendFile(path.join(dataDir,'admin-actions.jsonl'),JSON.stringify({at:new Date().toISOString(),performedBy,actingAs:actor.id,path:url.pathname,event:'Attempt'})+'\n',{mode:0o600});
        res.once('finish',()=>{void fs.appendFile(path.join(dataDir,'admin-actions.jsonl'),JSON.stringify({at:new Date().toISOString(),performedBy,actingAs:actor.id,path:url.pathname,status:res.statusCode,event:'Result'})+'\n',{mode:0o600}).catch(()=>console.error('Could not append admin action result.'));});
      }
      if(actor.role==='Customer'){
        if(url.pathname==='/api/customer/workspace'&&req.method==='GET')return json(res,200,portalRead(workspace.read(actor.id),actor.id));
        if(url.pathname==='/api/customer/decision'&&req.method==='POST')return json(res,200,await portalDecision(portal,actor.id,await readBody(req,8192)));
        return json(res,403,{error:'Customer accounts cannot access internal workspace data.'});
      }
      if(url.pathname==='/api/notifications/retry'&&req.method==='POST'){const input=await readBody(req,4096),mail=await portal.mail(input.id);if(mail?.staffId!==actor.id)return json(res,403,{error:'This notification is not yours.'});await portal.retry(input.id);await syncMail();return json(res,200,{ok:true});}
      if(url.pathname==='/api/notifications'&&req.method==='GET')return json(res,200,{configured:mailConfigured(mailSettings),mail:(await portal.list()).filter(m=>m.staffId===actor.id)});
      if(url.pathname.startsWith('/api/customer/')){
        if(actor.role!=='Admin')return json(res,403,{error:'Only Admin can manage customer access.'});
        if(url.pathname==='/api/customer/preview'&&req.method==='GET')return json(res,200,adminCustomerPreview(workspace.read(actor.id),actor.id,url.searchParams.get('customerId')));
        if(url.pathname==='/api/customer/project-invite'&&req.method==='POST'){const input=await readBody(req,8192);const result=await inviteProjectCustomer(portal,{validate:(c,v)=>auth.validateCustomerPassword(c,v.username,v.password),set:(c,v)=>auth.setCustomerPassword(c,v.username,v.password)},actor.id,input,mailSettings);await syncMail();return json(res,200,{...result,status:(await portal.mail(result.id)).status,configured:mailConfigured(mailSettings)});}
        if(url.pathname==='/api/customer/password'&&req.method==='POST'){const input=await readBody(req,4096),c=workspace.read(actor.id).state.business.customers?.find(c=>c.id===input.id&&c.active);if(!c)return json(res,400,{error:'Choose an active customer.'});return json(res,200,await auth.setCustomerPassword(c,input.username,input.password));}
        if(url.pathname==='/api/customer/admin'&&req.method==='GET'){await syncMail();return json(res,200,{configured:mailConfigured(mailSettings),mail:await portal.list(),logins:auth.customerLogins()});}
        if(url.pathname==='/api/customer/invite'&&req.method==='POST'){const input=await readBody(req,4096),c=workspace.read(actor.id).state.business.customers?.find(c=>c.id===input.id&&c.active);if(!c)return json(res,400,{error:'Choose an active customer.'});await issueCustomerLink(portal,mailSettings,c.email,{invite:true});await syncMail();return json(res,200,{ok:true,configured:mailConfigured(mailSettings)});}
        if(url.pathname==='/api/customer/retry'&&req.method==='POST'){const input=await readBody(req,4096);await portal.retry(input.id);await syncMail();return json(res,200,{ok:true});}
        return json(res,404,{error:'Not found.'});
      }
      if(url.pathname==='/api/settings/ai'){
        if(actor.role!=='Admin')return json(res,403,{error:'Only Admin can manage AI settings.'});
        if(req.method==='GET')return json(res,200,await aiSettings.public());
        return json(res,200,await aiSettings.save(await readBody(req,4096)));
      }
      if(url.pathname==='/api/contracts/analyze'&&req.method==='POST'){
        if(analyzing.has(actor.id)||analyzing.size>=2)return json(res,429,{error:'A contract analysis is already running. Please wait.'});
        analyzing.add(actor.id);try{return json(res,200,await analyzeContract(workspace.read(actor.id).state,actor.id,await readBody(req,5*1024*1024),await aiSettings.read(),checks,aiFetch));}finally{analyzing.delete(actor.id);}
      }
      if(url.pathname==='/api/workspace'&&req.method==='GET')return json(res,200,visibleRecord(workspace.read(actor.id),actor.id));
      if(url.pathname==='/api/workspace/command'&&req.method==='POST'){
        try{const result=await workspace.command(actor.id,await readBody(req),{performedBy});void syncMail().catch(()=>{});return json(res,200,visibleRecord(result,actor.id));}catch(e){return json(res,e.status||400,{error:e.message});}
      }
      if(url.pathname==='/api/expenses/check-abn'&&req.method==='POST')return json(res,200,await checkExpenseSupplier(await readBody(req,4096),actor.id,checks));
      if(url.pathname==='/api/invoices/check-abn'&&req.method==='POST')return json(res,200,await checkLocalInvoice(workspace,checks,actor.id,await readBody(req,5*1024*1024)));
      if(url.pathname==='/api/contracts/check-abn'&&req.method==='POST')return json(res,200,await checkLocalContract(workspace,checks,actor.id,await readBody(req,5*1024*1024)));
      if(!['/api/invoice/scan','/api/invoice/preview'].includes(url.pathname))return json(res,404,{error:'Not found.'});
    }
    if(['/api/invoice/scan','/api/invoice/preview'].includes(url.pathname)){
      if(req.method!=='POST')return json(res,405,{error:'Use POST.'});
      if(req.headers.origin!==host.origin||req.headers['x-requested-with']!=='ApprovalWorkspace'||!req.headers['content-type']?.startsWith('application/json'))return json(res,403,{error:'Open the invoice importer in this workspace.'});
      if(activeScans>=2)return json(res,429,{error:'Two invoices are already being scanned. Please try again shortly.'});
      activeScans++;
      try{
        const limit=Math.ceil(MAX_FILE_BYTES*4/3)+4096;
        if(Number(req.headers['content-length'])>limit)return json(res,413,{error:'Invoice files must be 2 MB or less.'});
        const chunks=[];let size=0;
        for await(const chunk of req){size+=chunk.length;if(size>limit)return json(res,413,{error:'Invoice files must be 2 MB or less.'});chunks.push(chunk);}
        let input;try{input=JSON.parse(Buffer.concat(chunks).toString());}catch{return json(res,400,{error:'Invalid upload data.'});}
        const result=await scanInvoice(input,{previewOnly:url.pathname.endsWith('/preview')});return json(res,200,result);
      }catch(error){return json(res,422,{error:error.message});}
      finally{activeScans--;}
    }
    if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed.'});
    const requested=decodeURIComponent(url.pathname);
    if(requested!=='/'&&!/^\/app\/[a-zA-Z0-9_./-]+\.(?:html|mjs|css|png|svg|woff2?)$/.test(requested))return json(res,404,{error:'Not found.'});
    const p=path.resolve(root,'.'+(requested==='/'?'/app/index.html':requested));
    if(!p.startsWith(path.join(root,'app')+path.sep))throw new Error('Forbidden');
    const body=await fs.readFile(p);
    const evidenceHtml=p.startsWith(path.join(root,'evidence')+path.sep)&&path.extname(p)==='.html';
    res.writeHead(200,{'Content-Type':evidenceHtml?'text/plain; charset=utf-8':types[path.extname(p)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:body);
  }catch(e){if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'The request could not be completed.'});}
});
const timer=setInterval(()=>void syncMail().catch(()=>{}),60000);timer.unref();server.on('close',()=>clearInterval(timer));
return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const server=await createWorkspaceServer();
 server.listen(Number(process.env.PORT||4185),'127.0.0.1',()=>console.log('Approval workspace: http://127.0.0.1:'+server.address().port));
}
