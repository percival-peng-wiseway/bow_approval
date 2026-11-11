import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';import {DatabaseSync} from 'node:sqlite';
export const checksum=bytes=>createHash('sha256').update(bytes).digest('hex');
export function exportFiles(sql){const db=new DatabaseSync(':memory:');try{db.exec(sql);return db.prepare('SELECT id,object_key,size FROM files WHERE committed=1 ORDER BY id').all();}finally{db.close();}}
export async function verifyBackup(dir){
 const manifest=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8'));if(manifest.version!==1||!Array.isArray(manifest.entries))throw new Error('Unsupported backup manifest.');
 if(!manifest.entries.some(e=>e.path==='database.sql'))throw new Error('Database export missing.');
 const seen=new Set();for(const e of manifest.entries){if(!/^(database\.sql|files\/[a-f0-9-]{36})$/.test(e.path)||seen.has(e.path))throw new Error('Invalid backup path.');seen.add(e.path);const file=path.join(dir,e.path);if(!(await fs.lstat(file)).isFile())throw new Error('Backup entries must be regular files.');const data=await fs.readFile(file);if(data.length!==e.size||checksum(data)!==e.sha256)throw new Error('Backup checksum mismatch: '+e.path);}
 const sql=await fs.readFile(path.join(dir,'database.sql'),'utf8'),files=exportFiles(sql);
 for(const file of files){const e=manifest.entries.find(e=>e.path==='files/'+file.id);if(!e||e.size!==file.size||e.objectKey!==file.object_key)throw new Error('Missing or mismatched attachment: '+file.id);}
 if(manifest.entries.length!==files.length+1)throw new Error('Unexpected backup entries.');return {manifest,sql,files};
}
export async function restoreIsolated(backup,destination){
 const {manifest,sql,files}=await verifyBackup(backup);await fs.mkdir(destination,{mode:0o700});
 const db=new DatabaseSync(path.join(destination,'database.sqlite'));try{db.exec(sql);db.exec('DELETE FROM sessions; DELETE FROM customer_links;');const tables=db.prepare("SELECT name FROM sqlite_master WHERE name='customer_mail'").all();if(tables.length)db.exec("UPDATE customer_mail SET status='cancelled',lease=NULL,lease_until=0,payload=json_set(payload,'$.status','cancelled')");const check=db.prepare('PRAGMA integrity_check').get();if(Object.values(check)[0]!=='ok')throw new Error('Restored database integrity check failed.');}finally{db.close();}
 await fs.chmod(path.join(destination,'database.sqlite'),0o600);await fs.mkdir(path.join(destination,'files'),{mode:0o700});for(const file of files){const target=path.join(destination,'files',file.id);await fs.copyFile(path.join(backup,'files',file.id),target);await fs.chmod(target,0o600);}
 await fs.writeFile(path.join(destination,'RESTORE.json'),JSON.stringify({verifiedAt:new Date().toISOString(),sourceEnvironment:manifest.environment,attachments:files.length,sessionsRevoked:true,mailDisabled:true}),{mode:0o600});return {attachments:files.length};
}
export async function exportLocalD1(persistTo){
 const folder=path.join(persistTo,'v3','d1'),files=[];
 async function visit(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(entry.isSymbolicLink())throw new Error('Unexpected symlink in database persistence.');const name=path.join(dir,entry.name);if(entry.isDirectory())await visit(name);else if(entry.name.endsWith('.sqlite')&&entry.name!=='metadata.sqlite')files.push(name);}}
 await visit(folder);if(files.length!==1)throw new Error('Choose a persistence folder containing exactly one D1 database.');
 const db=new DatabaseSync(files[0],{readOnly:true}),ident=s=>'"'+s.replaceAll('"','""')+'"',value=v=>v===null?'NULL':typeof v==='number'||typeof v==='bigint'?String(v):v instanceof Uint8Array?"X'"+Buffer.from(v).toString('hex')+"'":"'"+String(v).replaceAll("'","''")+"'";
 try{db.exec('BEGIN');const schema=db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY CASE type WHEN 'table' THEN 0 ELSE 1 END,name").all(),lines=['PRAGMA foreign_keys=OFF;','BEGIN TRANSACTION;'];
 for(const t of schema.filter(t=>t.type==='table')){lines.push(t.sql+';');for(const row of db.prepare('SELECT * FROM '+ident(t.name)).all())lines.push('INSERT INTO '+ident(t.name)+'('+Object.keys(row).map(ident).join(',')+') VALUES('+Object.values(row).map(value).join(',')+');');}
 for(const t of schema.filter(t=>t.type!=='table'))lines.push(t.sql+';');lines.push('COMMIT;');db.exec('COMMIT');return lines.join('\n');
 }finally{db.close();}
}
