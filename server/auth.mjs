import {publicDirectory,accountMetadata,validateStaffChange,strongPassword} from './accounts.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {users} from '../app/domain.mjs';
const scrypt=promisify(scryptCallback);
export const accountIds=['sam','director-b','director-c','jamie','alex','taylor','pm-b'];
export async function provisionAccounts(dir,password){
 await fs.mkdir(dir,{recursive:true,mode:0o700});
 const accounts=await Promise.all(accountIds.map(async id=>{const user=users.find(u=>u.id===id);const salt=randomBytes(16).toString('hex');return {id,username:user.name,salt,hash:(await scrypt(password,salt,64)).toString('hex')};}));
 await fs.writeFile(path.join(dir,'accounts.json'),JSON.stringify(accounts,null,2),{flag:'wx',mode:0o600});
}
const normalize=value=>String(value||'').trim().toLowerCase().replace(/\s+/g,' ');
const digest=value=>createHash('sha256').update(value).digest('hex');
export async function provisionAdminAccount(dir,password){
 if(typeof password!=='string'||password.length<6||password.length>200)throw new Error('Use a password of 6–200 characters.');
 const file=path.join(dir,'accounts.json'),accounts=JSON.parse(await fs.readFile(file,'utf8'));
 if(accounts.some(a=>a.id==='admin'||normalize(a.username)==='admin'))throw new Error('The admin account already exists. Existing credentials were not changed.');
 const salt=randomBytes(16).toString('hex'),hash=(await scrypt(password,salt,64)).toString('hex');
 accounts.push({id:'admin',username:'admin',salt,hash});
 await fs.writeFile(file+'.tmp',JSON.stringify(accounts,null,2),{mode:0o600});await fs.rename(file+'.tmp',file);
 return {id:'admin',username:'admin'};
}
export async function openAuth(dir,{customerById=()=>null}={}){
 let accounts=JSON.parse(await fs.readFile(path.join(dir,'accounts.json'),'utf8'));
 const sessions=new Map(),attempts=new Map();
 let accountQueue=Promise.resolve();
 const directory=()=>publicDirectory(accounts);
 const publicUser=id=>{const a=accounts.find(a=>a.id===id),u=directory().find(u=>u.id===id&&!u.inactive);return u?{...u,mustChangePassword:!!a?.mustChangePassword}:null;};
 const saveAccounts=async next=>{const file=path.join(dir,'accounts.json');await fs.writeFile(file+'.tmp',JSON.stringify(next,null,2),{mode:0o600});await fs.rename(file+'.tmp',file);accounts=next;};
 const revoke=id=>{for(const [key,s] of sessions)if(s.id===id)sessions.delete(key);};
 const serial=fn=>{const task=accountQueue.then(fn);accountQueue=task.catch(()=>{});return task;};
 const validateCustomerPassword=(customer,username,password)=>{
  username=String(username||customer.email).trim();
  if(!/^[a-zA-Z0-9@._+ -]{3,100}$/.test(username)||typeof password!=='string'||password.length<6||password.length>200)throw Object.assign(new Error('Use a username of 3–100 characters and a password of at least 6 characters.'),{status:400});
  if(accounts.some(a=>normalize(a.username)===normalize(username)&&a.id!==customer.id))throw Object.assign(new Error('This username is already in use.'),{status:409});
  return username;
 };
 return {
  validateCustomerPassword,
  directory,
  staffAccounts:()=>accountMetadata(accounts),
  saveStaff(actor,input,state){return serial(async()=>{
   const nextUser=validateStaffChange(accounts,actor,input,state),old=accounts.find(a=>a.id===nextUser.id);let next={...old,...nextUser};
   if(!old||input.password){const salt=randomBytes(16).toString('hex');next={...next,salt,hash:(await scrypt(input.password,salt,64)).toString('hex'),mustChangePassword:true,passwordUpdatedAt:new Date().toISOString()};}
   await saveAccounts([...accounts.filter(a=>a.id!==next.id),next]);revoke(next.id);
   await fs.appendFile(path.join(dir,'account-events.jsonl'),JSON.stringify({actor,accountId:next.id,action:!old?'Created':input.password?'Password reset':'Updated',at:new Date().toISOString()})+'\n',{mode:0o600});
   return {accounts:accountMetadata(accounts),directory:directory()};
  });},
  changePassword(id,currentPassword,password){return serial(async()=>{
   strongPassword(password);const old=accounts.find(a=>a.id===id);if(!old)throw Object.assign(new Error('Account not found.'),{status:401});
   if(!old.mustChangePassword){const check=await scrypt(String(currentPassword||''),old.salt,64);if(!timingSafeEqual(check,Buffer.from(old.hash,'hex')))throw Object.assign(new Error('Current password is incorrect.'),{status:400});}
   if(timingSafeEqual(await scrypt(password,old.salt,64),Buffer.from(old.hash,'hex')))throw Object.assign(new Error('Choose a different password.'),{status:400});
   const salt=randomBytes(16).toString('hex');const hash=(await scrypt(password,salt,64)).toString('hex');await saveAccounts(accounts.map(a=>a.id===id?{...a,salt,hash,mustChangePassword:false,passwordUpdatedAt:new Date().toISOString()}:a));revoke(id);return {ok:true};
  });},
  passwordVersion(id){const a=accounts.find(a=>a.id===id&&a.role==='Customer');return a?digest(a.salt):null;},
  customerLogins(){return accounts.filter(a=>a.role==='Customer').map(({id,username})=>({id,username}));},
  setCustomerPassword(customer,username,password){
   const task=accountQueue.then(async()=>{
    username=validateCustomerPassword(customer,username,password);
    const salt=randomBytes(16).toString('hex'),hash=(await scrypt(password,salt,64)).toString('hex');
    const next=accounts.filter(a=>a.id!==customer.id);next.push({id:customer.id,username,role:'Customer',salt,hash});
    const file=path.join(dir,'accounts.json');await fs.writeFile(file+'.tmp',JSON.stringify(next,null,2),{mode:0o600});await fs.rename(file+'.tmp',file);accounts=next;
    for(const [key,session] of sessions)if(session.id===customer.id)sessions.delete(key);
    return {username,version:digest(salt)};
   });accountQueue=task.catch(()=>{});return task;
  },
  createSession(user){const token=randomBytes(32).toString('hex');sessions.set(digest(token),{id:user.id,user,expires:Date.now()+43200000});return {user,cookie:`approval_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`};},
  user(req){const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('approval_session='))?.slice(17);if(!token)return null;const key=digest(token),session=sessions.get(key);if(!session||session.expires<Date.now()){sessions.delete(key);return null;}if(session.user?.role==='Customer'){const c=customerById(session.id);return c?.active?session.user:null;}return publicUser(session.id);},
  async login(username,password,address,audience='staff'){
   if(typeof username!=='string'||typeof password!=='string'||username.length>100||password.length>200)throw Object.assign(new Error('Enter your username and password.'),{status:400});
   const key=address+':'+normalize(username),now=Date.now();
   for(const [key,v] of attempts)if(v.until<now)attempts.delete(key);
   const failures=attempts.get(key)||{count:0,until:now+15*60*1000};
   const globalKey=address+':*',globalFailures=attempts.get(globalKey)||{count:0,until:now+15*60*1000};
   if(failures.count>=8||globalFailures.count>=40)throw Object.assign(new Error('Too many attempts. Try again in 15 minutes.'),{status:429});
   const account=accounts.find(a=>normalize(a.username)===normalize(username));
   const hash=await scrypt(String(password||''),account?.salt||'unknown-account',64);
   const customer=account?.role==='Customer'?customerById(account.id):null;
   const user=customer?.active?{id:customer.id,name:customer.contact||customer.name,email:customer.email,role:'Customer'}:account?.role==='Customer'?null:publicUser(account?.id);
   if(!account||!user||(audience==='customer')!==(account.role==='Customer')||!timingSafeEqual(hash,Buffer.from(account.hash,'hex'))){failures.count++;globalFailures.count++;attempts.set(key,failures);attempts.set(globalKey,globalFailures);throw Object.assign(new Error('Incorrect name or password.'),{status:401});}
   if(account.role!=='Customer'&&password.length<8&&!account.mustChangePassword){await serial(async()=>{await saveAccounts(accounts.map(a=>a.id===account.id?{...a,mustChangePassword:true}:a));});user.mustChangePassword=true;}
   attempts.delete(key);const token=randomBytes(32).toString('hex');
   for(const [key,s] of sessions)if(s.expires<now)sessions.delete(key);
   sessions.set(digest(token),{id:account.id,user,expires:now+12*60*60*1000});
   return {user,cookie:`approval_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`};
  },
  logout(req){const token=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('approval_session='))?.slice(17);if(token)sessions.delete(digest(token));return 'approval_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0';}
 };
}
