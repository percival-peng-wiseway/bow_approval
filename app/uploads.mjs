const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mimeByExtension={pdf:'application/pdf',png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',txt:'text/plain'};
export function filePicker(label,id,{multiple=true,invoice=false,maxBytes=3*1024*1024}={}){
 const accept='application/pdf,.pdf,image/jpeg,.jpg,.jpeg,image/png,.png,image/webp,.webp'+(invoice?'':',text/plain,.txt');
 return `<fieldset class="file-picker" data-file-picker="${id}" data-max-bytes="${maxBytes}" ${invoice?'data-invoice':''}><legend>${esc(label)}</legend><div class="file-picker-options"><label class="field">Files<input type="file" id="${id}" accept="${accept}" ${multiple?'multiple':''}></label><label class="field">Photos / library<input type="file" id="${id}-photos" accept="image/*" ${multiple?'multiple':''}></label></div><small>PDF, JPG, PNG, WebP${invoice?'':', TXT'} · up to ${maxBytes/1024/1024} MB. Export HEIC photos as JPG first.</small><p class="file-selection" role="status" aria-live="polite"></p><button type="button" data-clear-files>Clear selection</button></fieldset>`;
}
export function fileType(file){
 const extension=file.name.split('.').pop().toLowerCase();
 const type=mimeByExtension[extension];
 if(!type||(file.type&&file.type!=='application/octet-stream'&&file.type!==type))throw new Error('Choose PDF, JPG, PNG, WebP or TXT files. Export HEIC photos as JPG first.');
 return type;
}
export function validateFiles(files,maxBytes,{invoice=false}={}){
 if(files.length>20)throw new Error('Choose no more than 20 files at a time.');
 if(files.reduce((n,f)=>n+f.size,0)>maxBytes)throw new Error(`Files must total ${maxBytes/1024/1024} MB or less.`);
 for(const file of files){if(!file.size)throw new Error('Empty files cannot be uploaded.');const type=fileType(file);if(invoice&&type==='text/plain')throw new Error('Choose a PDF, PNG, JPG or WebP invoice.');}
}
export function selectedFiles(selector){
 const input=typeof selector==='string'?document.querySelector(selector):selector;
 const picker=input?.closest('[data-file-picker]');
 return picker?[...picker.querySelectorAll('input[type=file]')].flatMap(i=>[...(i.files||[])]):[...(input?.files||[])];
}
export function bindFilePickers(root){
 // Delegation also handles dynamically added supplier rows. Never re-render or
 // activate a picker through an async click: the visible native input owns the tap.
 root.addEventListener('change',e=>{
  const input=e.target,picker=input.closest?.('[data-file-picker]');if(!picker||input.type!=='file')return;
  const status=picker.querySelector('.file-selection');
  try{const files=selectedFiles(input);validateFiles(files,Number(picker.dataset.maxBytes),{invoice:picker.hasAttribute('data-invoice')});status.textContent=files.map(f=>`${f.name} (${Math.ceil(f.size/1024)} KB)`).join(' · ');}
  catch(error){input.value='';status.textContent=error.message;picker.dispatchEvent(new CustomEvent('files-selected',{bubbles:true,detail:{id:picker.dataset.filePicker,files:[],invalid:true}}));e.stopImmediatePropagation();return;}
  picker.dispatchEvent(new CustomEvent('files-selected',{bubbles:true,detail:{id:picker.dataset.filePicker,files:selectedFiles(input)}}));
 });
 root.addEventListener('click',e=>{if(!e.target.matches('[data-clear-files]'))return;const picker=e.target.closest('[data-file-picker]');picker.querySelectorAll('input').forEach(i=>i.value='');picker.querySelector('.file-selection').textContent='Selection cleared.';picker.dispatchEvent(new CustomEvent('files-selected',{bubbles:true,detail:{id:picker.dataset.filePicker,files:[]}}));});
}
export async function readUploadFiles(files,{maxBytes=3*1024*1024,signal,invoice=false}={}){
 validateFiles(files,maxBytes,{invoice});
 const result=[];
 for(const file of files){
  // Yield before each bounded read, so status text and touch feedback can paint.
  await new Promise(resolve=>setTimeout(resolve,0));
  if(signal?.aborted)throw new DOMException('Upload cancelled.','AbortError');
  const data=await new Promise((resolve,reject)=>{
   const reader=new FileReader(),abort=()=>reader.abort();
   const finish=fn=>value=>{signal?.removeEventListener('abort',abort);fn(value);};
   reader.onload=finish(()=>resolve(reader.result));reader.onerror=finish(()=>reject(new Error('Could not read file. Please select it again.')));reader.onabort=finish(()=>reject(new DOMException('Upload cancelled.','AbortError')));
   signal?.addEventListener('abort',abort,{once:true});reader.readAsDataURL(file);
  });
  // Some mobile file providers omit MIME; the validated extension supplies it.
  const type=fileType(file);result.push({name:file.name,size:file.size,type,data:`data:${type};base64,${data.split(',')[1]}`});
 }
 return result;
}
