import {defaultUsers} from '../app/domain.mjs';
const bad=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export const normalizeName=v=>String(v||'').trim().toLowerCase().replace(/\s+/g,' ');
export function strongPassword(password){if(typeof password!=='string'||password.length<8||password.length>200||!/[a-zA-Z]/.test(password)||!/[0-9]/.test(password))bad('Use 8–200 characters, including a letter and a number.');}
export function publicDirectory(accounts){
 const staff=accounts.filter(a=>a.role!=='Customer');
 return [...defaultUsers.filter(u=>!staff.some(a=>a.id===u.id)).map(u=>({...u,inactive:true})),...staff.map(a=>{const seed=defaultUsers.find(u=>u.id===a.id),name=a.displayName||a.display_name||seed?.name||a.username;return {id:a.id,name,role:a.role||seed?.role||'Employee',initials:name.trim().split(/\s+/).length>1?name.trim().split(/\s+/).map(s=>s[0]).slice(0,2).join('').toUpperCase():name.slice(0,2).toUpperCase(),inactive:a.active===false||a.active===0};})];
}
export function accountMetadata(accounts){return publicDirectory(accounts).filter(u=>accounts.some(a=>a.id===u.id&&a.role!=='Customer')).map(u=>{const a=accounts.find(a=>a.id===u.id);return {...u,username:a.username,mustChangePassword:!!(a.mustChangePassword??a.must_change_password),passwordUpdatedAt:a.passwordUpdatedAt||a.password_updated_at||null};});}
export function validateStaffChange(accounts,actor,input,state){
 const directory=publicDirectory(accounts),me=directory.find(u=>u.id===actor&&!u.inactive);
 if(me?.role!=='Admin')bad('Only Admin can manage staff accounts.',403);
 const old=accounts.find(a=>a.id===input.id),oldUser=directory.find(u=>u.id===input.id);
 if(input.id&&!old)bad('Account not found.',404);
 if(old?.role==='Customer')bad('Manage customer accounts in Customer Access.');
 const id=old?.id||crypto.randomUUID(),username=String(input.username||old?.username||'').trim(),displayName=String(input.name||oldUser?.name||'').trim(),role=String(input.role||oldUser?.role||'Employee'),active=input.active!==false;
 if(!/^[a-zA-Z0-9@._+ -]{3,100}$/.test(username)||!displayName||displayName.length>100)bad('Enter a username of 3–100 characters and a display name.');
 if(!['Admin','Finance','Director','PM','Employee'].includes(role))bad('Choose a supported staff role.');
 if(accounts.some(a=>a.id!==id&&normalizeName(a.username)===normalizeName(username)))bad('This username is already in use.',409);
 if(id===actor&&(!active||role!=='Admin'))bad('You cannot disable or remove your own Admin access.');
 if(['admin','alex','jamie'].includes(id)&&(!active||role!==oldUser.role))bad('This account is a core workflow approver. Transfer its workflow responsibilities before changing its role or disabling it.');
 if(old&&(!active||role!==oldUser.role)){
 const projects=state.business?.projects||[],requests=state.business?.requests||[];
 if(projects.some(p=>p.active!==false&&(p.pm===id||p.director===id))||requests.some(r=>!['Completed','Cancelled'].includes(r.stage)&&(r.requester===id||JSON.stringify(r.route||{}).includes('"'+id+'"'))))bad('Transfer active projects and requests before changing this account’s role or disabling it.');
 }
 if(!old||input.password)strongPassword(input.password);
 return {id,username,displayName,role,active};
}
