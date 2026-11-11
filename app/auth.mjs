let actingAs=null;
export function setActingAs(id){actingAs=id&&id!=='admin'?id:null;}
export async function requestApi(url,{method='GET',data}={}){
 const response=await fetch(url,{method,credentials:'same-origin',cache:'no-store',headers:{...(method==='POST'?{'Content-Type':'application/json','X-Requested-With':'ApprovalWorkspace'}:{}),...(actingAs&&!url.startsWith('/api/auth/')?{'X-Act-As':actingAs}:{})},body:data===undefined?undefined:JSON.stringify(data)});
 const result=await response.json();
 if(!response.ok){const error=Object.assign(new Error(result.error||'Please try again.'),{status:response.status});if(response.status===401&&url!=='/api/auth/login')window.dispatchEvent(new Event('session-expired'));throw error;}
 return result;
}
export function renderLogin(onSignedIn,message='',customer=false){
 document.querySelector('#overlay').innerHTML='';
 document.querySelector('#app').innerHTML=`<main class="login-page"><section class="login-card" aria-labelledby="login-title"><div class="login-brand"><img class="bow-logo" src="/app/bow-logo.png" alt=""> BOW OA</div><nav class="login-versions" aria-label="Sign-in version"><button type="button" id="staff-version" aria-pressed="${!customer}">Staff version</button><button type="button" id="customer-version" aria-pressed="${customer}">Customer version</button></nav><h1 id="login-title">${customer?'Customer sign-in':'Sign in'}</h1><p>${customer?'View your projects and confirm proposed services.':'Manage your requests and approvals.'}</p><form id="login-form"><label class="field">${customer?'Username':'Name'}<input name="username" autocomplete="username" required placeholder="${customer?'Your customer username':'Your name'}" maxlength="100" autocapitalize="none" spellcheck="false"></label><label class="field">Password<div class="login-password"><input id="login-password" name="password" type="password" autocomplete="current-password" required maxlength="200"><button type="button" id="show-password" aria-label="Show password" aria-pressed="false">Show</button></div></label><p id="login-error" role="alert"></p><button type="submit" class="primary login-submit">Sign in</button></form></section></main>`;
 document.querySelector('#staff-version').onclick=()=>{location.hash='staff';};
 document.querySelector('#customer-version').onclick=()=>{location.hash='customer';};
 document.querySelector('#login-error').textContent=message;
 const form=document.querySelector('#login-form'),password=document.querySelector('#login-password'),toggle=document.querySelector('#show-password');
 toggle.onclick=()=>{const show=password.type==='password';password.type=show?'text':'password';toggle.textContent=show?'Hide':'Show';toggle.setAttribute('aria-label',show?'Hide password':'Show password');toggle.setAttribute('aria-pressed',String(show));};
 form.onsubmit=async e=>{e.preventDefault();const button=form.querySelector('[type=submit]');if(button.disabled)return;button.disabled=true;button.textContent='Signing in…';document.querySelector('#login-error').textContent='';try{await requestApi('/api/auth/login',{method:'POST',data:{...Object.fromEntries(new FormData(form)),audience:customer?'customer':'staff'}});password.value='';await onSignedIn();}catch(error){if(form.isConnected){document.querySelector('#login-error').textContent=error.message;password.value='';password.focus();}}finally{if(form.isConnected){button.disabled=false;button.textContent='Sign in';}}};
}
