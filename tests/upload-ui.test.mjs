import test from 'node:test';
import assert from 'node:assert/strict';
import {bindFilePickers,selectedFiles} from '../app/uploads.mjs';
import {openInvoiceScanner} from '../app/invoice-scan.mjs';
import {openContractDialog} from '../app/contract-ui.mjs';

// Minimal DOM boundary: exercise the real event handlers and async reads without
// requiring a listening HTTP server or replacing the application's upload logic.
class Element extends EventTarget {
 constructor(parent=null){super();this.parent=parent;this.isConnected=true;this.value='';this.textContent='';this.innerHTML='';this.disabled=false;this.hidden=false;this.dataset={};this.classList={add(){},remove(){},toggle(){}};this.nodes=new Map();}
 querySelector(key){if(!this.nodes.has(key))this.nodes.set(key,new Element(this));return this.nodes.get(key);}
 querySelectorAll(key){
  if(key==='input'||key==='input[type=file]')return this.inputs||[];
  const match=/^\[data-(preview|replace|remove)-contract\]$/.exec(key);
  if(!match)return [];
  const html=this.querySelector('#contract-retained').innerHTML,cacheKey=key+html;
  if(!this.nodes.has(cacheKey))this.nodes.set(cacheKey,[...html.matchAll(new RegExp('data-'+match[1]+'-contract="(\\d+)"','g'))].map(m=>{const el=new Element(this);el.dataset[match[1]+'Contract']=m[1];return el;}));
  return this.nodes.get(cacheKey);
 }
 closest(key){return key==='[data-file-picker]'?(this.picker||this.parent?.closest(key)):null;}
 matches(key){return key==='[data-clear-files]'&&this.clear;}
 dispatchEvent(event){const result=super.dispatchEvent(event);if(event.bubbles)this.parent?.dispatchEvent(event);return result;}
 setAttribute(){}
 replaceChildren(){}
 append(){}
 scrollIntoView(){}
 reportValidity(){return true;}
}
function picker(root,id,{invoice=false,maxBytes=3*1024*1024}={}){
 const p=new Element(root);p.picker=p;p.dataset={filePicker:id,maxBytes:String(maxBytes)};p.hasAttribute=key=>invoice&&key==='data-invoice';
 p.inputs=[id,id+'-photos'].map(id=>{const input=new Element(p);input.picker=p;input.type='file';input.id=id;let files=[];Object.defineProperties(input,{files:{get:()=>files,set:v=>files=v},value:{get:()=>files.length?'selected':'',set:v=>{if(v==='')files=[];}}});return input;});
 return p;
}
function change(root,input){const event=new Event('change');Object.defineProperty(event,'target',{value:input});root.dispatchEvent(event);}
const tick=()=>new Promise(resolve=>setTimeout(resolve,2));
async function until(check){for(let i=0;i<200;i++){if(check())return;await tick();}assert.fail('Timed out waiting for upload handler');}
function globals(t,values){for(const [key,value] of Object.entries(values)){const descriptor=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});t.after(()=>descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key]);}}
function reader(t){const reads=[];class Reader{readAsDataURL(file){reads.push(file.name);this.timer=setTimeout(()=>{this.result='data:application/octet-stream;base64,YQ==';this.onload();},1);}abort(){clearTimeout(this.timer);this.onabort();}}globals(t,{FileReader:Reader});return reads;}

test('delegated pickers combine files/photos, reject invalid selections and clear without reading',t=>{
 const root=new Element(),p=picker(root,'dynamic-contract');bindFilePickers(root);const events=[];root.addEventListener('files-selected',e=>events.push(e.detail));
 globals(t,{FileReader:class{constructor(){assert.fail('Selection must not read file content');}}});
 p.inputs[0].files=[new File(['a'],'a.pdf')];change(root,p.inputs[0]);
 p.inputs[1].files=[new File(['b'],'b.jpg')];change(root,p.inputs[1]);assert.equal(events.at(-1).files.length,2);
 p.inputs[1].files=[new File(['x'],'bad.heic')];change(root,p.inputs[1]);assert.equal(events.at(-1).invalid,true);assert.equal(p.inputs[1].value,'');assert.match(p.querySelector('.file-selection').textContent,/HEIC/);assert.equal(selectedFiles(p.inputs[0]).length,1);
 const clear=new Element(p);clear.clear=true;const click=new Event('click');Object.defineProperty(click,'target',{value:clear});root.dispatchEvent(click);assert.deepEqual(events.at(-1).files,[]);assert.equal(p.inputs[0].value,'');
});

test('invoice scan failure permits the same photo twice; closing cancels a pending scan',async t=>{
 const root=new Element(),p=picker(root,'invoice-upload',{invoice:true,maxBytes:2*1024*1024}),error=new Element(),progress=new Element();
 const nodes=new Map([['#invoice-drop',root],['[data-file-picker=invoice-upload]',p],['#form-error',error],['#scan-progress',progress]]);
 globals(t,{document:{querySelector:key=>nodes.get(key)}});const reads=reader(t);let scans=0,closed,signal,finish;
 globals(t,{fetch:async(url,options)=>{scans++;signal=options.signal;if(scans===3)return new Promise(resolve=>finish=()=>resolve({ok:false,json:async()=>({error:'Late scan failure'})}));return {ok:false,json:async()=>({error:'Retry invoice'})};}});
 openInvoiceScanner({modal(title,body,footer,setup,focus,onClose){assert.match(body,/invoice-upload-photos/);closed=onClose;setup();},closeModal(){},onImport(){assert.fail('Failed scan must not import');}});
 const file=new File(['a'],'invoice.jpg');
 for(let i=1;i<=2;i++){p.inputs[1].files=[file];change(root,p.inputs[1]);await until(()=>p.querySelector('.file-selection').textContent==='Choose the file again to retry.'&&scans===i);assert.equal(p.inputs[1].value,'');assert.equal(p.disabled,false);assert.equal(error.textContent,'Retry invoice');}
 p.inputs[0].files=[new File([new Uint8Array(2*1024*1024+1)],'large.pdf')];change(root,p.inputs[0]);assert.equal(scans,2);assert.equal(reads.length,2);
 p.inputs[1].files=[file];change(root,p.inputs[1]);await until(()=>scans===3);closed();assert.equal(signal.aborted,true);error.textContent='Another dialog';finish();await tick();assert.equal(error.textContent,'Another dialog');
});

test('prod contract stages file/photo selections until Check ABN, normalizes MIME and invalidates after changes',async t=>{
 const form=new Element(),p=picker(form,'service-contract-files'),error=new Element(),save=new Element(),submit=new Element();form.nodes.set('[data-file-picker]',p);
 form.elements=Object.fromEntries(['abn','amount','paymentTerms','bankDetails','notes'].map(k=>[k,new Element()]));
 globals(t,{document:{querySelector:key=>({'#contract-form':form,'#form-error':error,'#contract-save':save,'#contract-submit':submit})[key],createElement:()=>new Element()}});
 const reads=reader(t),calls=[],previews=[],revoked=[];let close;globals(t,{URL:{createObjectURL:blob=>{previews.push(blob);return 'blob:preview-'+previews.length;},revokeObjectURL:url=>revoked.push(url)}});
 globals(t,{fetch:async(url,options)=>{calls.push({url,data:JSON.parse(options.body)});return {ok:true,json:async()=>({id:'check-1',status:'checked',selectedAbn:'51824753556',findings:[],candidates:[]})};}});
 const r={id:'service-1',finalSupplier:{},selectedQuote:'q',quotes:[{id:'q',supplier:'Supplier',amount:100,contractFiles:[]}]};
 openContractDialog(r,{modal(title,body,footer,setup,focus,onClose){assert.match(body,/service-contract-files-photos/);assert.doesNotMatch(body,/capture|type="file"[^>]*hidden/);close=onClose;setup();}});
 const select=async(input,file)=>{input.files=[file];change(form,input);await tick();};
 await select(p.inputs[0],new File(['a'],'contract.pdf'));
 await select(p.inputs[1],new File(['b'],'photo.jpg'));
 assert.equal(reads.length,0);assert.equal(calls.length,0);assert.match(form.querySelector('#contract-retained').innerHTML,/contract.pdf/);assert.match(form.querySelector('#contract-retained').innerHTML,/photo.jpg/);
 await form.querySelectorAll('[data-preview-contract]')[1].onclick();assert.equal(previews[0].type,'image/jpeg');assert.equal(reads.length,0);assert.equal(calls.length,0);
 await form.querySelector('#verify-contract-abn').onclick();assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/contracts/check-abn');assert.deepEqual(reads,['contract.pdf','photo.jpg']);assert.deepEqual(calls[0].data.files.map(f=>f.type),['application/pdf','image/jpeg']);assert.equal(form.elements.abn.value,'51824753556');
 await form.querySelector('#verify-contract-abn').onclick();assert.equal(reads.length,2,'checked files reuse encoded content');
 form.querySelectorAll('[data-replace-contract]')[0].onclick();assert.equal(p.inputs[0].multiple,false);await select(p.inputs[1],new File(['c'],'new-contract.txt'));assert.equal(p.inputs[0].multiple,true);assert.doesNotMatch(form.querySelector('#contract-retained').innerHTML,/contract.pdf/);assert.match(form.querySelector('#contract-retained').innerHTML,/new-contract.txt/);assert.deepEqual(revoked,['blob:preview-1']);assert.equal(reads.length,2);assert.equal(form.querySelector('#contract-abn-result').innerHTML,'');
 const pending=form.querySelector('#verify-contract-abn').onclick();close();form.isConnected=false;await pending;assert.equal(calls.length,2,'closing prevents a pending read from submitting');
});
