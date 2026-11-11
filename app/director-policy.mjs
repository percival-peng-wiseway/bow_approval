import {users} from './domain.mjs';
export const directorThreshold=5000;
export const projectDirector=r=>r.route?.projectDirector||r.route?.director;
export const lastProjectPayment=(r,p=r.payments?.find(p=>p.status!=='Paid'))=>r.kind==='service'&&!!p&&r.payments.filter(p=>p.status!=='Cancelled').at(-1)?.id===p.id;
export const directorPaymentApproved=(r,p)=>!!projectDirector(r)&&(p?.projectDirectorApproval?.by===projectDirector(r)||p?.acceptance?.approvedBy===projectDirector(r));
export function directorPaymentPending(r){const p=r.payments?.find(p=>p.status!=='Paid');return !['Completed','Cancelled'].includes(r.stage)&&lastProjectPayment(r,p)&&!directorPaymentApproved(r,p)&&['Payment review','Ready to pay','Project Director sign-off'].includes(r.stage);}
export function directorGate(r,base,amount){
 if(r.kind!=='service'||Math.round(Number(amount)*100)<=directorThreshold*100)return base;
 const ids=r.route?.directors||users.filter(u=>u.role==='Director'&&!u.inactive).map(u=>u.id);
 if(new Set(ids).size<3)throw new Error('Assign three active Directors before approving a service above AUD 5,000.');
 return {...base,...Object.fromEntries(ids.filter(id=>id!==r.requester&&!Object.values(base).includes(id)).map(id=>['director:'+id,id]))};
}
export const allGateVotes=(reviewers,votes)=>Object.keys(reviewers).every(key=>!!votes?.[key]);
