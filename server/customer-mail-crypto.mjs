// Pending credential invitations are encrypted at rest and never returned by admin APIs.
const fail=()=>{throw Object.assign(new Error('Configure CUSTOMER_MAIL_KEY (64 hexadecimal characters) before sending credential invitations.'),{status:503});};
const bytes=hex=>Uint8Array.from(hex.match(/../g)||[],v=>parseInt(v,16));
const hex=value=>Array.from(new Uint8Array(value),v=>v.toString(16).padStart(2,'0')).join('');
async function key(secret){if(!/^[a-f0-9]{64}$/i.test(secret||''))fail();return crypto.subtle.importKey('raw',bytes(secret),'AES-GCM',false,['encrypt','decrypt']);}
export async function sealCredential(secret,password){const iv=crypto.getRandomValues(new Uint8Array(12)),data=await crypto.subtle.encrypt({name:'AES-GCM',iv},await key(secret),new TextEncoder().encode(password));return {iv:hex(iv),data:hex(data)};}
export async function openCredential(secret,sealed){const data=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(sealed.iv)},await key(secret),bytes(sealed.data));return new TextDecoder().decode(data);}
