import http from 'node:http';
import {scanInvoice,MAX_FILE_BYTES} from './service.mjs';
let busy=false;
const send=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
http.createServer(async(req,res)=>{
 if(req.url==='/health'&&req.method==='GET')return send(res,200,{ok:true});
 if(req.method!=='POST'||!['/api/invoice/scan','/api/invoice/preview'].includes(req.url))return send(res,404,{error:'Not found.'});
 if(busy)return send(res,429,{error:'An invoice is already being scanned. Try again shortly.'});
 busy=true;
 try{
  const limit=Math.ceil(MAX_FILE_BYTES*4/3)+4096,chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>limit)return send(res,413,{error:'Invoice files must be 2 MB or less.'});chunks.push(chunk);}
  let input;try{input=JSON.parse(Buffer.concat(chunks).toString());}catch{return send(res,400,{error:'Invalid upload data.'});}
  const result=await scanInvoice(input,{previewOnly:req.url.endsWith('/preview')});result.engine='Cloud PDF text + Tesseract OCR';return send(res,200,result);
 }catch(e){return send(res,422,{error:e.message});}finally{busy=false;}
}).listen(8080,'0.0.0.0');
