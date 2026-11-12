import {requestApi} from './auth.mjs';
import {passwordError,passwordHint} from './password-policy.mjs';
import {users} from './domain.mjs';
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const field=(label,name,autocomplete='new-password',required=true)=>`<label class="field">${label}<input type="password" name="${name}" autocomplete="${autocomplete}" maxlength="${name==='currentPassword'?200:128}" ${required?'required':''}></label>`;
const changeForm=()=>`<form id="password-form"><p>${passwordHint}</p>${field('Current password','currentPassword','current-password')}${field('New password','newPassword')}${field('Confirm new password','confirmPassword')}<p role="alert" class="error" id="password-error"></p><button class="primary" type="submit">Change password</button></form>`;
function bindChange(onSaved){
 const form=document.querySelector('#password-form'),error=form.querySelector('#password-error'),button=form.querySelector('[type=submit]');
 form.onsubmit=async e=>{e.preventDefault();if(button.disabled)return;const data=Object.fromEntries(new FormData(form));error.textContent=passwordError(data.newPassword,data.confirmPassword);if(error.textContent)return;button.disabled=true;try{await requestApi('/api/auth/change-password',{method:'POST',data});form.reset();await onSaved();}catch(e){if(form.isConnected)error.textContent=e.message;}finally{button.disabled=false;}};
}
export function requirePasswordChange(onSaved,signOut){
 document.querySelector('#overlay').innerHTML='';
 document.querySelector('#app').innerHTML=`<main class="login-page"><section class="login-card"><h1>Change temporary password</h1><p>Choose your own password before opening the workspace.</p>${changeForm()}<button id="password-signout" class="login-submit" type="button">Sign out</button></section></main>`;
 bindChange(onSaved);document.querySelector('#password-signout').onclick=signOut;
}
export function openPasswordSettings({user,modal,closeModal,onSaved}){
 modal('Account security',`${changeForm()}${user.role==='Admin'?'<hr><button type="button" id="reset-employee">Reset an employee password</button>':''}`,'<button data-close>Close</button>',()=>{
  bindChange(async()=>{closeModal();await onSaved();});
  document.querySelector('#reset-employee')?.addEventListener('click',()=>openReset({user,modal}));
 },true);
}
function openReset({user,modal}){
 modal('Reset employee password',`<form id="reset-password-form"><label class="field">Employee<select name="accountId" required><option value="">Select an employee</option>${users.filter(u=>u.id!==user.id&&!u.inactive&&u.role!=='Customer').map(u=>`<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('')}</select></label><p>Leave both password fields blank to generate a random temporary password, shown once. All their sessions will end and they must change it at next sign-in.</p><p>${passwordHint}</p>${field('Temporary password (optional)','temporaryPassword','new-password',false)}${field('Confirm temporary password','confirmPassword','new-password',false)}<p class="error" role="alert" id="reset-error"></p><button type="submit" class="primary">Reset password</button></form><div id="reset-result" role="status"></div>`,'<button data-close>Close</button>',()=>{
  const form=document.querySelector('#reset-password-form'),error=document.querySelector('#reset-error'),result=document.querySelector('#reset-result'),button=form.querySelector('[type=submit]');
  form.onsubmit=async e=>{e.preventDefault();if(button.disabled)return;const data=Object.fromEntries(new FormData(form));error.textContent=data.temporaryPassword||data.confirmPassword?passwordError(data.temporaryPassword,data.confirmPassword):'';if(error.textContent)return;button.disabled=true;
   try{const response=await requestApi('/api/admin/reset-password',{method:'POST',data});if(!form.isConnected)return;form.reset();form.remove();result.innerHTML='<p>Password reset. The employee must change it at next sign-in.</p>';if(response.temporaryPassword){const label=document.createElement('label');label.className='field';label.textContent='Copy this temporary password now. It will not be shown again.';const output=document.createElement('input');output.readOnly=true;output.autocomplete='off';output.value=response.temporaryPassword;output.setAttribute('aria-label','Temporary password');label.append(output);result.append(label);output.addEventListener('click',()=>output.select());}}
   catch(e){if(form.isConnected){error.textContent=e.message;button.disabled=false;}}
  };
 },true);
}
