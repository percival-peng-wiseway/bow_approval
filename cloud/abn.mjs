import {createContractCheck,inlineContract,lookupAbn,verifySourceChecks} from '../server/abn-check.mjs';
import {readWorkspace} from './workspace.mjs';
import {allowedActions} from '../app/business.mjs';
import {fail} from './http.mjs';
export function cloudCheckStore(env,actor){return {
 async readFile(file){const ref=/^\/api\/files\/([a-f0-9-]{36})$/.exec(file?.data||'');if(!ref)return inlineContract(file);const row=await env.DB.prepare('SELECT * FROM files WHERE id=? AND (committed=1 OR uploaded_by=?)').bind(ref[1],actor).first();if(!row)fail(400,'Contract attachment unavailable.');const object=await env.FILES.get(row.object_key);if(!object)fail(400,'Contract attachment unavailable.');return {bytes:Buffer.from(await object.arrayBuffer()),type:row.mime_type};},
 async load(id){const row=await env.DB.prepare('SELECT payload FROM contract_abn_checks WHERE id=?').bind(id).first();return row?JSON.parse(row.payload):null;},
 async save(result){await env.DB.prepare('INSERT INTO contract_abn_checks(id,actor,request_id,created_at,payload) VALUES(?,?,?,?,?)').bind(result.id,actor,result.requestId,Date.now(),JSON.stringify(result)).run();},
 lookup:abn=>lookupAbn(abn,env.ABN_LOOKUP_GUID),
 async scan(input){const response=await env.OCR.getByName('invoice-ocr').fetch(new Request('http://container/api/invoice/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)}));if(!response.ok)throw new Error('Cannot read document.');return response.json();}
};}
export async function checkContract(env,actor,input){const {state}=await readWorkspace(env,actor);const request=state.business.requests.find(v=>v.id===input.requestId);if(!request||!allowedActions(request,actor).includes('source'))fail(403,'Only the applicant can check contracts at the sourcing stage.');return createContractCheck(input,actor,cloudCheckStore(env,actor));}
export const verifyCloudChecks=(env,actor,input)=>verifySourceChecks(input,actor,cloudCheckStore(env,actor));
