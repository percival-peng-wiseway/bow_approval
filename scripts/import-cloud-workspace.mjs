import fs from 'node:fs/promises';
import readline from 'node:readline/promises';
import {Writable} from 'node:stream';
const [target,file]=process.argv.slice(2);
if(!target||!file)throw new Error('Usage: node scripts/import-cloud-workspace.mjs https://YOUR-WORKER.workers.dev /private/path/backup.json');
const url=new URL(target);if(url.protocol!=='https:'&& !['localhost','127.0.0.1'].includes(url.hostname))throw new Error('Use HTTPS for cloud imports.');
const base=url.origin,backup=JSON.parse(await fs.readFile(file,'utf8')),state=backup.state||backup;
if(!Array.isArray(state?.business?.requests)||!Array.isArray(state?.business?.projects))throw new Error('Not a workspace backup.');
let muted=false;
const output=new Writable({write(chunk,encoding,callback){if(!muted)process.stdout.write(chunk,encoding);callback();}});
const rl=readline.createInterface({input:process.stdin,output,terminal:!!process.stdin.isTTY});
let cookie;
const call=async(path,data)=>{const response=await fetch(base+path,{method:data?'POST':'GET',redirect:'error',headers:{...(cookie?{Cookie:cookie}:{}),...(data?{'Content-Type':'application/json',Origin:base,'X-Requested-With':'ApprovalWorkspace'}:{})},body:data?JSON.stringify(data):undefined});const body=await response.json();if(!response.ok)throw new Error(body.error||'Import request failed.');return {response,body};};
try{
 const username=await rl.question('Admin name: ');process.stdout.write('Password (hidden): ');muted=true;let password=await rl.question('');muted=false;process.stdout.write('\n');rl.close();
 const login=await call('/api/auth/login',{username,password});password='';cookie=login.response.headers.get('set-cookie').split(';')[0];
 const current=(await call('/api/workspace')).body;if(!current.canImport)throw new Error('Destination is not empty. Existing data has been preserved.');
 const imported=(await call('/api/workspace/command',{operation:'import',revision:current.revision,data:state})).body;
 const verify=(await call('/api/workspace')).body;
 if(verify.revision!==imported.revision||verify.state.business.requests.length!==state.business.requests.length)throw new Error('Import requires manual verification.');
 console.log(`Imported ${state.business.projects.length} projects and ${state.business.requests.length} business requests. Verify attachments in the cloud workspace before retiring the original backup.`);
}finally{rl.close();if(cookie)await call('/api/auth/logout',{}).catch(()=>{});}
