import fs from 'node:fs/promises';
import path from 'node:path';
export const DEFAULT_CONTRACT_MODEL='gpt-6-luna';
export async function openAISettings(dir){
 const file=path.join(dir,'ai-settings.json');
 const read=async()=>{try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;return {model:DEFAULT_CONTRACT_MODEL,enabled:false,apiKey:''};}};
 const metadata=s=>({provider:'OpenAI',model:s.model||DEFAULT_CONTRACT_MODEL,enabled:!!s.enabled,configured:!!s.apiKey,updatedAt:s.updatedAt||null});
 let queue=Promise.resolve();
 return {read,public:async()=>metadata(await read()),save:input=>{const task=queue.then(async()=>{const old=await read();const model=String(input.model||DEFAULT_CONTRACT_MODEL).trim();if(!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(model))throw Object.assign(new Error('Enter a valid model ID.'),{status:400});const key=String(input.apiKey||'').trim();if(key&&(!key.startsWith('sk-')||key.length<20||key.length>1024||/\s/.test(key)))throw Object.assign(new Error('Enter a valid OpenAI API key.'),{status:400});const apiKey=input.clearKey===true?'':key||old.apiKey||'';const next={model,apiKey,enabled:input.enabled===true,updatedAt:new Date().toISOString()};await fs.mkdir(dir,{recursive:true,mode:0o700});const tmp=file+'.tmp';await fs.writeFile(tmp,JSON.stringify(next),{mode:0o600});await fs.rename(tmp,file);return metadata(next);});queue=task.catch(()=>{});return task;}};
}
