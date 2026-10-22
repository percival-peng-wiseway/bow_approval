const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=s=>document.querySelector(s);
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
export function openInvoiceScanner({modal,closeModal,onImport,onCancel}) {
  let completed=false;let file=null,attachment=null,result=null,controller=null,previewURL=null;
  const teardown=()=>{controller?.abort();if(previewURL)URL.revokeObjectURL(previewURL);};
  const closed=()=>{teardown();if(!completed&&onCancel)queueMicrotask(onCancel);};
  const error=message=>{const el=$('#form-error');if(el)el.textContent=message;};
  function upload(){
    modal('Scan invoice',`<div id="invoice-drop" class="invoice-drop"><div class="scan-symbol">↥</div><h3>Drop your invoice here</h3><p>PDF, JPG, PNG or WebP · up to 2 MB · up to 10 pages</p><label class="scan-file-button">Choose invoice<input id="invoice-upload" type="file" accept=".pdf,.png,.jpg,.jpeg,.webp" aria-label="Upload invoice to scan"></label><div id="scan-progress" role="status" aria-live="polite"></div></div><p class="info">Read text PDFs or scan images locally. Review the extracted fields before creating a request.</p>`,`<button data-close>Cancel</button>`,()=>{
      $('#invoice-upload').onchange=e=>{if(e.target.files[0])scan(e.target.files[0]);};
      const drop=$('#invoice-drop');
      drop.ondragover=e=>{e.preventDefault();drop.classList.add('dragover');};
      drop.ondragleave=()=>drop.classList.remove('dragover');
      drop.ondrop=e=>{e.preventDefault();drop.classList.remove('dragover');if(e.dataTransfer.files.length!==1)return error('Upload one invoice at a time.');scan(e.dataTransfer.files[0]);};
    },true,closed);
  }
  async function scan(selected){
    if(controller)return;
    error('');
    if(selected.size>2*1024*1024)return error('Please use an invoice of 2 MB or less.');
    if(!/\.(pdf|png|jpe?g|webp)$/i.test(selected.name))return error('Choose a PDF, PNG, JPG or WebP invoice.');
    file=selected;controller=new AbortController();$('#invoice-upload').disabled=true;
    $('#scan-progress').innerHTML='<span class="scan-spinner"></span> Reading invoice…';
    try{
      attachment=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve({name:file.name,size:file.size,type:file.type,data:r.result});r.onerror=()=>reject(new Error('Could not read this file.'));r.readAsDataURL(file);});
      if(controller.signal.aborted)return;
      const response=await fetch('/api/invoice/scan',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'ApprovalWorkspace'},body:JSON.stringify({name:file.name,data:attachment.data.split(',')[1]}),signal:controller.signal});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Scanning failed.');
      result=data;controller=null;review();
    }catch(e){if(e.name==='AbortError')return;controller=null;error(e.message);if($('#invoice-upload'))$('#invoice-upload').disabled=false;if($('#scan-progress'))$('#scan-progress').textContent='';}
  }
  function review(){
    previewURL=URL.createObjectURL(file);
    const f=result.fields;
    const labels={supplier:'Supplier',reference:'Invoice number',date:'Invoice date',dueDate:'Due date',abn:'Supplier ABN',currency:'Currency',subtotal:'Subtotal (ex GST)',tax:'GST amount',total:'Invoice total'};
    const input=(key,type='text')=>`<label class="field scan-field">${labels[key]}<input id="scan-${key}" name="${key}" type="${type}" ${['supplier','reference','date','currency','subtotal','tax','total'].includes(key)?'required':''} ${type==='number'?'min="0" step="0.01"':''} value="${esc(f[key]??'')}" placeholder="${type==='number'?'Enter amount':'Not found — enter manually'}"><small class="scan-source ${f[key]===''||f[key]===null?'missing':''}" title="${esc(result.evidence[key]?.text||'')}">${f[key]===''||f[key]===null?'Not found':result.evidence[key]?.kind==='calculated'?'Calculated — check against invoice':result.evidence[key]?.kind==='header candidate'?'Header candidate — check supplier':'Detected — review'}</small></label>`;
    const foreign=f.currency&&f.currency!=='AUD';
    const unsupportedCredit=/\b(?:credit\s+note|credit\s+memo)\b/i.test(result.text);
    modal('Review invoice',`<div class="scan-meta"><strong>${esc(file.name)}</strong><span>${result.pages.length} page${result.pages.length===1?'':'s'} · ${result.pages.some(p=>p.method==='OCR')?'OCR':'PDF text'}</span></div><div class="scan-review"><div class="scan-preview">${result.previews?.length?result.previews.map(p=>`<div class="preview-page-number">Page ${p.number} of ${result.pages.length}</div><img alt="Invoice page ${p.number}" src="${p.data}">`).join(''):`<img alt="Original uploaded invoice" src="${previewURL}">`}</div><form id="scan-fields"><div class="form-grid">${input('supplier')}${input('reference')}${input('date','date')}${input('dueDate','date')}${input('abn')}${input('currency')}${input('subtotal','number')}${input('tax','number')}${input('total','number')}</div><div id="scan-totals-check" class="info" role="status"></div></form></div>${result.warnings.length?`<div class="scan-warnings">${result.warnings.map(w=>`<div>${esc(w)}</div>`).join('')}</div>`:''}<p class="info">Check the total against your invoice before continuing.</p><details class="scan-text"><summary>View extracted text</summary><pre>${esc(result.text)}</pre></details><label class="scan-confirm"><input type="checkbox" id="scan-confirm">I have checked the fields and totals against the invoice.</label>`,`<button id="scan-back">Choose another file</button><button class="primary" id="use-invoice" ${foreign||unsupportedCredit?'disabled':''}>Use invoice details</button>`,()=>{
      $('#overlay .modal').classList.add('scan-modal');
      $('#scan-back').onclick=()=>{teardown();previewURL=null;file=null;attachment=null;result=null;upload();};
      $('#scan-fields').onsubmit=e=>e.preventDefault();
      $('#scan-currency').readOnly=Boolean(foreign);
      const check=()=>{const subtotal=Number($('#scan-subtotal').value),tax=Number($('#scan-tax').value),total=Number($('#scan-total').value);const missing=['subtotal','tax','total'].some(k=>$('#scan-'+k).value==='');const matches=!missing&&Math.abs(round(subtotal+tax)-total)<.005;$('#scan-totals-check').textContent=missing?'Enter all three amounts, including 0 GST for a tax-free invoice.':matches?'✓ Subtotal + GST matches the invoice total.':'Subtotal + GST must equal the invoice total. Check adjustments.';$('#scan-totals-check').style.color=matches?'#238460':'#ac7944';return matches;};
      ['subtotal','tax','total'].forEach(k=>$('#scan-'+k).oninput=check);check();
      $('#use-invoice').onclick=()=>{
        error('');const form=$('#scan-fields');if(!form.reportValidity())return;
        const values=Object.fromEntries(new FormData(form));
        if(values.currency.trim().toUpperCase()!=='AUD')return error('This workspace supports AUD invoices only. No currency conversion is performed.');
        if(!check())return error('Correct the amounts so the subtotal plus GST equals the invoice total.');
        if(!$('#scan-confirm').checked)return error('Check the invoice and confirm the fields before continuing.');
        const subtotal=Number(values.subtotal),tax=Number(values.tax),total=Number(values.total);
        if(!Number.isSafeInteger(Math.round(total*100))||subtotal<=0)return error('Enter a positive, supported subtotal.');
        const rate=Math.round(tax/subtotal*100*1e6)/1e6;
        if(rate>100||round(subtotal+round(subtotal*rate/100))!==round(total))return error('These amounts cannot be represented by a single tax rate. Enter the Bill manually with separate line items.');
        const data={type:'Bill',supplier:values.supplier.trim(),reference:values.reference.trim(),date:values.date,dueDate:values.dueDate,department:'Operations',note:values.abn?`Supplier ABN: ${values.abn}`:'',items:[{description:`Invoice ${values.reference.trim()} — summary`,quantity:1,unitPrice:subtotal,taxRate:rate,account:'Expenses'}]};
        const original=attachment;completed=true;closeModal();onImport(data,original);
      };
    },false,closed);
  }
  upload();
}
