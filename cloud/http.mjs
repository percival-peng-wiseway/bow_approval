export const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function json(value,status=200,headers={}){return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin',...headers}});}
export async function readJson(request,limit=12*1024*1024){
 if(Number(request.headers.get('Content-Length'))>limit)fail(413,'Request is too large.');
 const reader=request.body?.getReader();if(!reader)fail(400,'Missing request body.');
 const parts=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();fail(413,'Request is too large.');}parts.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 try{return JSON.parse(new TextDecoder().decode(bytes));}catch{fail(400,'Invalid JSON request.');}
}
export function sameOrigin(request){if(request.headers.get('Origin')!==new URL(request.url).origin||request.headers.get('X-Requested-With')!=='ApprovalWorkspace'||!request.headers.get('Content-Type')?.startsWith('application/json'))fail(403,'Open this action in the workspace.');}
