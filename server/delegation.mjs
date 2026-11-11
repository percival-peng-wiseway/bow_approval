import {users} from '../app/domain.mjs';
export function delegatedActor(authenticated,target){
 if(!target)return authenticated;
 if(authenticated.id!=='admin'||authenticated.role!=='Admin')throw Object.assign(new Error('Only the dedicated admin account can act on behalf of staff.'),{status:403});
 const user=users.find(u=>u.id===target&&!u.inactive);
 if(!user)throw Object.assign(new Error('Choose an active staff member.'),{status:400});
 return user;
}
