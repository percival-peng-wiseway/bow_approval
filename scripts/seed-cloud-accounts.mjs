import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {randomBytes,scryptSync} from 'node:crypto';
import {users} from '../app/domain.mjs';
const [environment,mode,...flags]=process.argv.slice(2);
if(!['QA','prod'].includes(environment)||!['--local','--remote'].includes(mode))throw new Error('Usage: node scripts/seed-cloud-accounts.mjs QA|prod --local|--remote [--test]');
if(flags.includes('--test')&&mode!=='--local')throw new Error('Test accounts are only allowed in the local emulator.');
let accounts;
if(flags.includes('--test'))accounts=users.filter(u=>!u.inactive).map(u=>{const salt=randomBytes(16).toString('hex');return {id:u.id,username:u.name,salt,hash:scryptSync('browser-test-password',salt,64).toString('hex')};});
else accounts=JSON.parse(await fs.readFile(path.join(process.env.APP_DATA_DIR||'.local','accounts.json'),'utf8'));
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const sql=accounts.map(a=>{const u=users.find(u=>u.id===a.id&&!u.inactive);if(!u)throw new Error('Unknown account.');if(!/^[a-f0-9]{32}$/.test(a.salt)||!/^[a-f0-9]{128}$/.test(a.hash))throw new Error('Invalid password hash.');return `INSERT INTO accounts(id,username,normalized_name,role,salt,password_hash) VALUES(${[a.id,u.name,u.name.toLowerCase(),u.role,a.salt,a.hash].map(quote).join(',')}) ON CONFLICT(id) DO NOTHING;`;}).join('\n');
await fs.mkdir('.local',{recursive:true,mode:0o700});const file=path.resolve('.local',`seed-${environment}-${Date.now()}.sql`);
await fs.writeFile(file,sql,{mode:0o600});
try{const result=spawnSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','DB','--env',environment,mode,'--file',file],{stdio:'pipe',encoding:'utf8'});if(result.status!==0)throw new Error('Account seed failed. Check D1 permissions and migrations.');console.log(`Initialized ${accounts.length} account records in ${environment} (${mode.slice(2)}); existing accounts were preserved.`);}finally{await fs.rm(file,{force:true});}
