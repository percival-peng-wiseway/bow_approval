import fs from 'node:fs/promises';
import path from 'node:path';
const root=new URL('../',import.meta.url),out=new URL('../dist/',import.meta.url);
await fs.rm(out,{recursive:true,force:true});await fs.mkdir(new URL('app/',out),{recursive:true});
for(const file of await fs.readdir(new URL('app/',root))){if(/\.(mjs|css|png|svg|woff2?)$/.test(file))await fs.copyFile(new URL('app/'+file,root),new URL('app/'+file,out));}
await fs.copyFile(new URL('app/index.html',root),new URL('index.html',out));
console.log('Prepared public assets in dist/.');
