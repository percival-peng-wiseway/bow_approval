import {Readable} from 'node:stream';
// Invoke the real HTTP request listener without binding a TCP port. This allows
// route/security integration tests in sandboxes which prohibit listen().
export function localRequest(server,url,init={}){
 return new Promise((resolve,reject)=>{
  const parsed=new URL(url),headers=Object.fromEntries(new Headers(init.headers));headers.host=parsed.host;
  const req=Readable.from(init.body?[Buffer.from(init.body)]:[]);Object.assign(req,{url:parsed.pathname+parsed.search,method:init.method||'GET',headers,socket:{remoteAddress:'127.0.0.1'}});
  const responseHeaders=new Headers();const res={status:200,headersSent:false,setHeader(name,value){responseHeaders.set(name,value);},writeHead(status,values={}){this.status=status;this.headersSent=true;for(const [name,value] of Object.entries(values))responseHeaders.set(name,value);},end(body){resolve(new Response(body,{status:this.status,headers:responseHeaders}));}};
  try{server.emit('request',req,res);}catch(error){reject(error);}
 });
}
