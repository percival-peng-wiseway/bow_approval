// Read-only remote backup. Never deploys, imports or overwrites an existing backup.
import fs from 'node:fs/promises';import path from 'node:path';import {execFileSync} from 'node:child_process';
import {checksum,exportFiles,verifyBackup,exportLocalD1} from './lib/backup.mjs';
const [environment,destination,...flags]=process.argv.slice(2);
const local=flags.includes('--local'),persist=flags.includes('--persist-to')?flags[flags.indexOf('--persist-to')+1]:null;
if(flags.some((f,i)=>f!=='--local'&&f!=='--persist-to'&&flags[i-1]!=='--persist-to')||persist&&!local||flags.includes('--persist-to')&&!persist)throw new Error('Invalid local backup flags.');
const mode=local?['--local',...(persist?['--persist-to',persist]:[])]:['--remote'];
if(!['QA','prod'].includes(environment)||!destination)throw new Error('Usage: node scripts/backup-cloud.mjs QA|prod /absolute/private/new-backup-folder');
const root=path.resolve(new URL('..',import.meta.url).pathname),out=path.resolve(destination);
if(!path.isAbsolute(destination)||out.startsWith(path.join(root,'dist')+path.sep))throw new Error('Use an absolute private destination outside public assets.');
process.umask(0o077);await fs.mkdir(out,{mode:0o700});await fs.mkdir(path.join(out,'files'),{mode:0o700});
const config=JSON.parse(await fs.readFile(path.join(root,'wrangler.jsonc'),'utf8')),bucket=config.env[environment].r2_buckets[0].bucket_name;
const wrangler=args=>execFileSync(process.execPath,[path.join(root,'node_modules/wrangler/bin/wrangler.js'),...args],{cwd:root,stdio:['ignore','pipe','pipe'],maxBuffer:16*1024*1024});
try{
 if(local)await fs.writeFile(path.join(out,'database.sql'),await exportLocalD1(persist||path.join(root,'.wrangler/state')),{mode:0o600});
 else wrangler(['d1','export','DB','--env',environment,'--remote','--output',path.join(out,'database.sql')]);
 const bytes=await fs.readFile(path.join(out,'database.sql')),files=exportFiles(bytes.toString()),entries=[{path:'database.sql',size:bytes.length,sha256:checksum(bytes)}];
 for(const f of files){if(!/^files\/[a-f0-9-]{36}$/.test(f.object_key)||! /^[a-f0-9-]{36}$/.test(f.id))throw new Error('Unexpected attachment key.');const target=path.join(out,'files',f.id);wrangler(['r2','object','get',bucket+'/'+f.object_key,...mode,'--file',target]);const data=await fs.readFile(target);if(data.length!==f.size)throw new Error('Attachment size mismatch.');entries.push({path:'files/'+f.id,objectKey:f.object_key,size:data.length,sha256:checksum(data)});}
 await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify({version:1,environment,local,createdAt:new Date().toISOString(),entries},null,2),{mode:0o600});await verifyBackup(out);console.log(`Verified ${files.length} attachments and the database export. Backup: ${out}`);
}catch(error){console.error('Backup incomplete. Do not use this folder for restore. No remote data was changed.');throw new Error(error.status?'Cloudflare export/download failed; verify CLI authentication and access.':error.message);}
