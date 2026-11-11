import {AsyncLocalStorage} from 'node:async_hooks';
import {setDirectoryProvider,defaultUsers} from '../app/domain.mjs';
export const directoryContext=new AsyncLocalStorage();
setDirectoryProvider(()=>directoryContext.getStore()||defaultUsers);
export const runWithDirectory=(directory,fn)=>directoryContext.run(directory,fn);
