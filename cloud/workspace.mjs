import {verifyCloudChecks} from './abn.mjs';
import {initialState} from '../app/domain.mjs';
import {applyCommand} from '../server/commands.mjs';
import {normalizeFiles,referencedFileIds,discardFiles} from './files.mjs';
import {fail} from './http.mjs';
const collections={customer:s=>s.business.customers||[],project:s=>s.business.projects,request:s=>s.business.requests,legacy:s=>s.requests};
const fresh=()=>{const s=initialState();s.requests=[];s.business={projects:[],requests:[],customers:[]};delete s.actor;return s;};
function safeJson(value){const json=JSON.stringify(value);if(new TextEncoder().encode(json).length>1800000)fail(413,'This record is too large. Split the request into smaller records.');return json;}
export async function readWorkspace(env,actor){
 const [meta,entities]=await env.DB.batch([env.DB.prepare('SELECT * FROM workspace_meta WHERE id=1'),env.DB.prepare('SELECT * FROM entities ORDER BY position ASC')]);
 const row=meta.results[0];if(!row)fail(503,'Database migrations have not been applied.');
 const base=JSON.parse(row.base_json),state={...fresh(),...base,requests:[],business:{projects:[],requests:[],customers:[]}};
 for(const item of entities.results){const target=collections[item.collection]?.(state);if(target)target.push(JSON.parse(item.payload));}
 state.actor=actor;state.storageMode='cloud';state.environment=env.APP_ENV||'prod';
 return {state,revision:row.revision,imported:!!row.imported,canImport:row.revision===0&&!row.imported};
}
export async function command(env,actor,input){
 const before=await readWorkspace(env,actor);
 if(input.revision!==before.revision)fail(409,'The workspace changed. Review the latest data and try again.');
 if(input.operation==='import'&&(actor!=='alex'||!before.canImport))fail(actor==='alex'?409:403,'Only the Admin can import into an empty workspace.');
 const created=[];let committed=false;
 try{
  await verifyCloudChecks(env,actor,input);
  const clean=await normalizeFiles(input,env,actor,created);
  let state=structuredClone(before.state),result,imported=before.imported;
  if(clean.operation==='import'){
   const s=clean.data;if(!Array.isArray(s?.requests)||!s.workflows||!Array.isArray(s?.business?.projects)||!Array.isArray(s?.business?.requests))fail(400,'Invalid workspace backup.');
   state=s;imported=true;result={imported:true};
  }else result=applyCommand(state,actor,clean);
  const base={...state};delete base.actor;delete base.storageMode;delete base.environment;delete base.requests;delete base.business;
  const commit=crypto.randomUUID();
  const statements=[env.DB.prepare('UPDATE workspace_meta SET revision=revision+1,last_commit=?,base_json=?,imported=? WHERE id=1 AND revision=?').bind(commit,safeJson(base),imported?1:0,before.revision)];
  const guard='(SELECT last_commit FROM workspace_meta WHERE id=1)=?';
  for(const [collection,get] of Object.entries(collections)){
   const old=new Map(get(before.state).map(v=>[v.id,v]));
   for(const [position,entity] of get(state).entries()){
    if(!entity.id)fail(400,'A record is missing its ID.');
    const previous=old.get(entity.id);const payload=safeJson(entity);
    if(previous&&payload===JSON.stringify(previous)&&get(before.state).findIndex(v=>v.id===entity.id)===position)continue;
    statements.push(env.DB.prepare(`INSERT INTO entities(collection,id,payload,position) SELECT ?,?,?,? WHERE ${guard} ON CONFLICT(collection,id) DO UPDATE SET payload=excluded.payload,position=excluded.position`).bind(collection,entity.id,payload,position,commit));
    if(collection==='request'){
     const seen=new Set((previous?.history||[]).map((e,i)=>e.id||`${entity.id}:${i}`));
     for(const [i,event] of (entity.history||[]).entries()){
      const id=event.id||`${entity.id}:${i}`;if(seen.has(id))continue;
      statements.push(env.DB.prepare(`INSERT OR IGNORE INTO approval_events(id,request_id,actor,action,created_at,payload) SELECT ?,?,?,?,?,? WHERE ${guard}`).bind(id,entity.id,event.actor,event.action,event.at,safeJson(event),commit));
     }
    }
   }
  }
  for(const id of referencedFileIds(input.operation==='import'?state:result))statements.push(env.DB.prepare(`UPDATE files SET committed=1 WHERE id=? AND committed=0 AND ${guard}`).bind(id,commit));
  statements.push(env.DB.prepare(`INSERT INTO workspace_commits(id,revision,actor,operation,created_at) SELECT ?,?,?,?,? WHERE ${guard}`).bind(commit,before.revision+1,actor,input.operation,Date.now(),commit));
  if(statements.length>900)fail(413,'This import is too large for one transaction. Import a smaller workspace.');
  const writes=await env.DB.batch(statements);
  if(!writes[0].meta.changes)fail(409,'The workspace changed. Review the latest data and try again.');
  committed=true;
  return {state:{...state,actor,storageMode:'cloud',environment:env.APP_ENV||'prod'},revision:before.revision+1,canImport:false,imported,result};
 }catch(error){if(!committed)await discardFiles(env,created).catch(()=>{});throw error;}
}
