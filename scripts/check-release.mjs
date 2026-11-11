import fs from 'node:fs/promises';import {DatabaseSync} from 'node:sqlite';
const migrations=(await fs.readdir('migrations')).filter(f=>f.endsWith('.sql')).sort(),db=new DatabaseSync(':memory:');
try{for(const file of migrations)db.exec(await fs.readFile('migrations/'+file,'utf8'));const result=db.prepare('PRAGMA integrity_check').get();if(Object.values(result)[0]!=='ok')throw new Error('Migration integrity failed.');}finally{db.close();}
for(const f of await fs.readdir('dist'))if(!['app','index.html'].includes(f))throw new Error('Unexpected public build content: '+f);
for(const f of await fs.readdir('dist/app')){if(!/\.(mjs|css|png|svg|woff2?)$/.test(f))throw new Error('Unexpected asset: '+f);if(/\.(mjs|css)$/.test(f)){const text=await fs.readFile('dist/app/'+f,'utf8');if(/sk-(?:proj-)?[A-Za-z0-9_-]{32,}/.test(text))throw new Error('Potential API key in public bundle.');}}
console.log(`Verified ${migrations.length} migrations and public asset allowlist. QA runtime, OCR, secrets and isolated recovery still require release evidence.`);
