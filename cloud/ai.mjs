// Secrets are provisioned through Cloudflare; only non-secret preferences are stored in D1.
import {analyzeContract} from '../server/contract-ai.mjs';
import {cloudCheckStore} from './abn.mjs';
import {readWorkspace} from './workspace.mjs';
import {fail} from './http.mjs';
export async function cloudAISettings(env){
 const row=await env.DB.prepare("SELECT payload FROM app_settings WHERE id='contract-ai'").first();
 const settings=row?JSON.parse(row.payload):{};
 return {model:settings.model||env.OPENAI_MODEL||'gpt-6-luna',enabled:settings.enabled===true,apiKey:env.OPENAI_API_KEY||''};
}
export async function cloudAIMetadata(env){const s=await cloudAISettings(env);return {provider:'OpenAI',model:s.model,enabled:s.enabled,configured:!!s.apiKey,secretManaged:true};}
export async function saveCloudAISettings(env,input,actor){
 if(input.apiKey||input.clearKey)fail(400,'Manage OPENAI_API_KEY as a Cloudflare Secret. API keys are not stored in the database.');
 const model=String(input.model||'gpt-6-luna').trim();if(!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,119}$/.test(model))fail(400,'Enter a valid model ID.');
 if(input.enabled===true&&!env.OPENAI_API_KEY)fail(400,'Configure OPENAI_API_KEY before enabling contract AI.');
 await env.DB.prepare("INSERT INTO app_settings(id,payload,updated_by,updated_at) VALUES('contract-ai',?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_by=excluded.updated_by,updated_at=excluded.updated_at").bind(JSON.stringify({model,enabled:input.enabled===true}),actor,Date.now()).run();return cloudAIMetadata(env);
}
export async function analyzeCloudContract(env,actor,input,fetcher=fetch){return analyzeContract((await readWorkspace(env,actor)).state,actor,input,await cloudAISettings(env),cloudCheckStore(env,actor),fetcher);}
