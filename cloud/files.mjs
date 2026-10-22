import {fail} from './http.mjs';
const inline=/^data:(application\/pdf|image\/(?:png|jpeg|webp)|text\/plain);base64,([A-Za-z0-9+/]+={0,2})$/;
const reference=/^\/api\/files\/([a-f0-9-]{36})$/;
export const fileValue=row=>({id:row.id,name:row.name,type:row.mime_type,size:row.size,data:'/api/files/'+row.id});
export async function normalizeFiles(value,env,actor,created=[],cache=new Map(),depth=0){
 if(depth>60)fail(400,'Request nesting is too deep.');
 if(!value||typeof value!=='object')return value;
 if(typeof value.data==='string'&&typeof value.name==='string'){
  if(cache.has(value.data))return cache.get(value.data);
  const ref=reference.exec(value.data);
  if(ref){const row=await env.DB.prepare('SELECT * FROM files WHERE id=? AND (committed=1 OR uploaded_by=?)').bind(ref[1],actor).first();if(!row)fail(400,'An attachment is unavailable. Upload it again.');const file=fileValue(row);cache.set(value.data,file);return file;}
  const match=inline.exec(value.data);if(!match)fail(400,'Upload a PDF, image or text document.');
  const bytes=Uint8Array.from(atob(match[2]),c=>c.charCodeAt(0));if(!bytes.length||bytes.length>3*1024*1024)fail(413,'Each attachment must be less than 3 MB.');
  if(created.length>=80)fail(413,'Too many attachments in one request.');
  const id=crypto.randomUUID(),name=value.name.trim().slice(0,200);if(!name)fail(400,'An attachment name is required.');
  const row={id,object_key:'files/'+id,name,mime_type:match[1],size:bytes.length,uploaded_by:actor};
  await env.FILES.put(row.object_key,bytes,{httpMetadata:{contentType:row.mime_type}});
  created.push(row);
  await env.DB.prepare('INSERT INTO files(id,object_key,name,mime_type,size,uploaded_by,created_at) VALUES(?,?,?,?,?,?,?)').bind(id,row.object_key,name,row.mime_type,row.size,actor,Date.now()).run();
  const file=fileValue(row);cache.set(value.data,file);return file;
 }
 if(Array.isArray(value)){const out=[];for(const item of value)out.push(await normalizeFiles(item,env,actor,created,cache,depth+1));return out;}
 const out={};for(const [key,item] of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(key))fail(400,'Invalid field.');out[key]=await normalizeFiles(item,env,actor,created,cache,depth+1);}return out;
}
export function referencedFileIds(value,ids=new Set()){
 if(!value||typeof value!=='object')return ids;
 if(typeof value.data==='string'){const ref=reference.exec(value.data);if(ref)ids.add(ref[1]);}
 for(const item of Object.values(value))referencedFileIds(item,ids);return ids;
}
export async function discardFiles(env,created){for(const row of created){const record=await env.DB.prepare('SELECT committed FROM files WHERE id=?').bind(row.id).first();if(record?.committed)continue;await env.FILES.delete(row.object_key);await env.DB.prepare('DELETE FROM files WHERE id=? AND committed=0').bind(row.id).run();}}
export async function downloadFile(request,env,user,id){
 const row=await env.DB.prepare('SELECT * FROM files WHERE id=? AND (committed=1 OR uploaded_by=?)').bind(id,user.id).first();if(!row)fail(404,'Attachment not found.');
 const object=await env.FILES.get(row.object_key);if(!object)fail(404,'Attachment not found.');
 return new Response(request.method==='HEAD'?null:object.body,{headers:{'Content-Type':row.mime_type,'Content-Length':String(row.size),'Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(row.name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
}
