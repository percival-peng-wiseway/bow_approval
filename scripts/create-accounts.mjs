import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {provisionAccounts} from '../server/auth.mjs';
const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
const password=Buffer.concat(chunks).toString().trim();
if(!password)throw new Error('Provide the initial password on standard input.');
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
await provisionAccounts(process.env.APP_DATA_DIR||path.join(root,'.local'),password);
console.log('Created seven accounts. Passwords stored as salted scrypt hashes.');
