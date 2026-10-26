import {localCheckStore,checkLocalContract,verifySourceChecks} from './server/abn-local.mjs';
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
export async function createWorkspaceServer({dataDir=process.env.APP_DATA_DIR||path.join(root,'.local')}={}){
const checks=await localCheckStore(dataDir);
const auth=await openAuth(dataDir),workspace=await openWorkspace(dataDir,{verifyCommand:(actor,input)=>verifySourceChecks(input,actor,checks)});
let activeScans=0;
const readBody=async(req,limit=12*1024*1024)=>{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>limit)throw Object.assign(new Error('Request is too large.'),{status:413});chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString());}catch{throw Object.assign(new Error('Invalid request.'),{status:400});}};
const server=http.createServer(async(req,res)=>{
  try{
    const host=new URL('http://'+req.headers.host);
    if(!['127.0.0.1','localhost'].includes(host.hostname))return json(res,403,{error:'Local access only.'});
    const url=new URL(req.url,host);
    if(url.pathname.startsWith('/api/')){
      if(!['GET','POST'].includes(req.method))return json(res,405,{error:'Method not allowed.'});
      if(req.method==='POST'&&(req.headers.origin!==host.origin||req.headers['x-requested-with']!=='ApprovalWorkspace'||!req.headers['content-type']?.startsWith('application/json')))return json(res,403,{error:'Open this action in the workspace.'});
      if(url.pathname==='/api/auth/login'&&req.method==='POST'){
        const input=await readBody(req,4096);const session=await auth.login(input.username,input.password,req.socket.remoteAddress);res.setHeader('Set-Cookie',session.cookie);return json(res,200,{user:session.user});
      }
      const actor=auth.user(req);
      if(!actor)return json(res,401,{error:'Please sign in to continue.'});
      if(url.pathname==='/api/auth/me'&&req.method==='GET')return json(res,200,{user:actor});
      if(url.pathname==='/api/auth/logout'&&req.method==='POST'){res.setHeader('Set-Cookie',auth.logout(req));return json(res,200,{ok:true});}
      if(url.pathname==='/api/workspace'&&req.method==='GET')return json(res,200,workspace.read(actor.id));
      if(url.pathname==='/api/workspace/command'&&req.method==='POST'){
        try{return json(res,200,await workspace.command(actor.id,await readBody(req)));}catch(e){return json(res,e.status||400,{error:e.message});}
      }
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
return server;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const server=await createWorkspaceServer();
 server.listen(Number(process.env.PORT||4185),'127.0.0.1',()=>console.log('Approval workspace: http://127.0.0.1:'+server.address().port));
}
