import {createHash,randomUUID} from 'node:crypto';
const need=(condition,message)=>{if(!condition)throw Object.assign(new Error(message),{status:400});};
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const cleanAbn=value=>String(value||'').replace(/\D/g,'');
export function validAbn(value){const n=cleanAbn(value);return /^\d{11}$/.test(n)&&[10,1,3,5,7,9,11,13,15,17,19].reduce((sum,w,i)=>sum+(Number(n[i])-(i===0?1:0))*w,0)%89===0;}
export function extractAbns(text){return [...new Set([...String(text).matchAll(/\b(?:ABN\s*[:.#-]?\s*)?(\d{2}[ \t-]?\d{3}[ \t-]?\d{3}[ \t-]?\d{3})\b/gi)].map(m=>cleanAbn(m[1])))];}
const normalizedName=s=>String(s||'').toUpperCase().replace(/&/g,' AND ').replace(/[^A-Z0-9]+/g,' ').trim().replace(/\s+/g,' ');
export const nameMatches=(supplier,names)=>names.some(n=>normalizedName(n)&&normalizedName(n)===normalizedName(supplier));
const xmlValue=(xml,tag)=>{const m=xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,'i'));return (m?.[1]||'').replace(/<[^>]+>/g,'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;|&#39;/g,"'").trim();};
const blocks=(xml,tag)=>[...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`,'gi'))].map(m=>m[1]);
export function parseAbnResponse(xml,abn){
 if(xmlValue(xml,'exceptionDescription')||xmlValue(xml,'exceptionMessage'))throw new Error('Official lookup unavailable.');
 const entity=blocks(xml,'businessEntity202001')[0];if(!entity||cleanAbn(xmlValue(blocks(entity,'ABN')[0]||'','identifierValue'))!==abn)throw new Error('Invalid official response.');
 const names=[...blocks(entity,'mainName').map(v=>xmlValue(v,'organisationName')),...blocks(entity,'businessName').map(v=>xmlValue(v,'organisationName')),...blocks(entity,'legalName').map(v=>['givenName','otherGivenName','familyName'].map(t=>xmlValue(v,t)).filter(Boolean).join(' '))].filter(Boolean);
 const status=xmlValue(blocks(entity,'entityStatus')[0]||'','entityStatusCode')||'Unknown';
 const gst=blocks(entity,'goodsAndServicesTax').filter(v=>!xmlValue(v,'effectiveTo')||xmlValue(v,'effectiveTo').startsWith('0001-'));
 return {abn,source:'official',entityName:names[0]||'',names,status,gstRegistered:gst.length>0,gstFrom:gst.length?xmlValue(gst[0],'effectiveFrom').slice(0,10):'',url:'https://abr.business.gov.au/ABN/View?abn='+abn};
}
export async function lookupAbn(abn,guid,fetcher=fetch){
 if(!validAbn(abn))return {abn,source:'invalid',status:'Invalid ABN',entityName:'',names:[],gstRegistered:null};
 if(!guid)return {abn,source:'unavailable',status:'Not checked',entityName:'',names:[],gstRegistered:null};
 try{
  const url=new URL('https://abr.business.gov.au/abrxmlsearch/AbrXmlSearch.asmx/SearchByABNv202001');url.searchParams.set('searchString',abn);url.searchParams.set('includeHistoricalDetails','N');url.searchParams.set('authenticationGuid',guid);
  const response=await fetcher(url,{headers:{Accept:'text/xml'},signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('Unavailable');
  return parseAbnResponse(await response.text(),abn);
 }catch{return {abn,source:'unavailable',status:'Lookup unavailable',entityName:'',names:[],gstRegistered:null};}
}
export async function inlineContract(file){
 const match=/^data:(application\/pdf|image\/(?:png|jpeg|webp)|text\/plain);base64,([A-Za-z0-9+/]+={0,2})$/.exec(file?.data||'');need(match,'Upload a PDF, image or text contract.');
 const bytes=Buffer.from(match[2],'base64');need(bytes.length>0&&bytes.length<=3*1024*1024,'Contract files must be under 3 MB.');return {bytes,type:match[1]};
}
async function materialize(files,readFile){need(Array.isArray(files)&&files.length>0&&files.length<=20,'Upload 1–20 contract files before checking ABN.');const out=[];let total=0;for(const file of files){const item=await readFile(file);total+=item.bytes.length;need(total<3*1024*1024,'Contract files must total less than 3 MB.');out.push({...item,name:String(file.name||''),sha256:digest(item.bytes)});}return out;}
const fingerprint=files=>digest(JSON.stringify(files.map(f=>[f.name,f.sha256]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))));
export async function createContractCheck(input,actor,{readFile=inlineContract,scan,lookup,save}){
 const supplier=String(input.supplier||'').trim();need(supplier&&supplier.length<=300,'Enter the supplier name before checking ABN.');
 const files=await materialize(input.files,readFile),warnings=[],extracted=[];let unreadable=false;
 for(const f of files){try{const text=f.type==='text/plain'?f.bytes.toString('utf8'):(await scan({name:f.name,data:f.bytes.toString('base64')})).text;need(typeof text==='string'&&text.trim(),'No readable text.');extracted.push(...extractAbns(text));}catch{unreadable=true;warnings.push('Could not fully read '+f.name+'. Review the original contract.');}}
 const detected=[...new Set(extracted)],entered=cleanAbn(input.abn);need(!input.abn||/^\d{11}$/.test(entered),'Enter an 11-digit supplier ABN.');
 const ids=[...new Set([...detected,...(entered?[entered]:[])])];need(ids.length<=12,'Too many ABNs found. Upload the relevant contract pages.');
 const entries=[];for(const id of ids){const entry=await lookup(id);entries.push({...entry,nameMatch:nameMatches(supplier,entry.names||[])});}
 const matches=entries.filter(v=>v.nameMatch&&detected.includes(v.abn));
 const selected=entered|| (matches.length===1?matches[0].abn:entries.length===1?entries[0].abn:'');const entity=entries.find(v=>v.abn===selected);
 if(!selected)warnings.push(entries.length?'Multiple contract ABNs found. Identify the supplier ABN, or explain the unresolved identity for review.':'No ABN found in the contract. Enter the supplier ABN, or explain why it is unavailable.');
 if(entered&&!detected.includes(entered))warnings.push('The entered ABN was not detected in the contract. Confirm it against the original document.');
 if(entity){if(entity.source!=='official')warnings.push(entity.source==='invalid'?'The supplier ABN fails its checksum.':'Official ABN Lookup could not be completed.');else{if(entity.status.toLowerCase()!=='active')warnings.push('Supplier ABN status: '+entity.status+'.');if(!entity.nameMatch)warnings.push('Supplier name does not exactly match the registered or business names.');if(entity.gstRegistered===false)warnings.push('Supplier is not currently registered for GST. Review any GST charged.');}}
 const result={id:randomUUID(),requestId:input.requestId,actor,supplier,checkedAt:new Date().toISOString(),fingerprint:fingerprint(files),files:files.map(({name,sha256})=>({name,sha256})),detected,selectedAbn:selected,entries,warnings,status:warnings.length||unreadable?'review':'checked'};
 await save(result);return result;
}
export async function verifySourceChecks(input,actor,{readFile=inlineContract,load}){
 if(input.operation!=='action'||input.action!=='source')return;
 need(Array.isArray(input.data?.quotes),'Add supplier quotes.');
 for(const q of input.data.quotes){
  need(/^[a-f0-9-]{36}$/.test(q.abnCheckId||''),'Check the ABN for each supplier contract before sending for review.');
  const check=await load(q.abnCheckId);need(check&&check.actor===actor&&check.requestId===input.id,'Run a new ABN check for this request.');
  need(Date.now()-Date.parse(check.checkedAt)<86400000,'The ABN check is over 24 hours old. Check again.');
  need(check.supplier===String(q.supplier||'').trim(),'Supplier changed. Check ABN again.');
  need(fingerprint(await materialize(q.contractFiles,readFile))===check.fingerprint,'Contract files changed. Check ABN again.');
  const note=String(q.abnReviewNote||'').trim();need(note.length<=3000,'Review note is too long.');
  if(check.status==='review')need(note.length>=10,'Explain the ABN findings for Finance and Director review (at least 10 characters).');
  q.abnCheck={...check,reviewNote:note};delete q.abnCheckId;delete q.abnReviewNote;
 }
}
