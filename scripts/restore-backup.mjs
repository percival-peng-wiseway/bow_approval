import path from 'node:path';import {restoreIsolated} from './lib/backup.mjs';
const [source,target]=process.argv.slice(2);if(!source||!target||!path.isAbsolute(target))throw new Error('Usage: node scripts/restore-backup.mjs /private/backup /absolute/new-isolated-folder');
const result=await restoreIsolated(path.resolve(source),target);console.log(`Isolated restore verified: ${result.attachments} attachments. Sessions revoked and mail disabled. No remote data changed.`);
