export function readiness({accounts=[],ai={},env={},cloud=false,abnConfigured=!!env.ABN_LOOKUP_GUID}={}){
 const active=accounts.filter(a=>!a.inactive),directors=active.filter(a=>a.role==='Director');
 return {checks:[
 {label:'Staff credentials',ready:active.length>0&&active.every(a=>a.passwordUpdatedAt&&!a.mustChangePassword),detail:'Every active staff account must have a rotated password. Use Manage staff and Change password; existing credentials are never silently reset.'},
 {label:'Director coverage',ready:directors.length>=3,detail:`${directors.length} active Directors. Services over AUD 5,000 require independent Director approvals.`},
 {label:'Contract AI',ready:!!(ai.configured&&ai.enabled),detail:ai.configured?(ai.enabled?'Configured and enabled.':'Configured but disabled.'):cloud?'Set OPENAI_API_KEY as a Cloudflare Secret, then enable Contract AI.':'Configure Contract AI in API settings.'},
 {label:'ABN Lookup',ready:abnConfigured,detail:abnConfigured?'Credential configured; external service availability is checked when used.':'Configure the ABN Lookup credential before live supplier verification.'},
 {label:'Customer invitations',ready:!!(env.RESEND_API_KEY&&env.EMAIL_FROM&&/^https:\/\//.test(env.PUBLIC_APP_URL||'')&&(!cloud||/^[a-f0-9]{64}$/i.test(env.CUSTOMER_MAIL_KEY||''))),detail:'Requires Resend, verified sender, public HTTPS URL and encrypted invitation storage. A saved invitation is not a delivered email.'},
 {label:'Release rehearsal',ready:false,detail:'Run the release checks, apply migrations in QA, exercise OCR and test an isolated backup restore before production. Configuration checks alone do not establish production readiness.'}
 ]};
}
