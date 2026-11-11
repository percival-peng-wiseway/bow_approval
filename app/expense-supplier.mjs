import {abnSummary} from './abn-ui.mjs';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function expenseAmount(invoice){
 const explicit=invoice.amount??invoice.total;
 if(explicit!==undefined&&explicit!==null&&explicit!=='')return Number.isFinite(Number(explicit))?Number(explicit).toFixed(2):'';
 if(!invoice.items?.length)return '';
 const cents=invoice.items.reduce((sum,i)=>sum+Math.round((Number(i.quantity)*Number(i.unitPrice)*(1+Number(i.taxRate)/100)+Number.EPSILON)*100),0);
 return Number.isFinite(cents)?(cents/100).toFixed(2):'';
}
export function importedExpense(invoice){return {amount:expenseAmount(invoice),supplier:invoice.supplier||'',supplierAbn:invoice.abn||'',supplierBankDetails:invoice.bankDetails||'',supplierAbnCheck:null,supplierCheckId:'',invoiceReference:invoice.reference||'',invoiceDate:invoice.date||''};}
export function expenseSupplierSummary(r){
 if(r.kind==='service'||![r.supplier,r.supplierAbn,r.supplierBankDetails,r.supplierAbnCheck].some(Boolean))return '';
 const facts=[['Supplier',r.supplier||'Not found'],['ABN',r.supplierAbn||'Not found'],['Bank details',r.supplierBankDetails||'Not found']];
 return `<section class="expense-supplier-summary"><h3>Supplier details</h3><dl class="overview-list">${facts.map(([k,v])=>`<div class="overview-row"><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>${r.supplierAbnCheck?abnSummary(r.supplierAbnCheck):'<p class="muted">ABN not checked.</p>'}</section>`;
}
export function expenseSupplierFields(r){
 return `<details class="expense-supplier-editor" ${r.supplier||r.supplierAbn||r.supplierBankDetails?'open':''}><summary>Supplier details</summary><div class="form-grid"><label class="field">Supplier name<input name="supplier" maxlength="300" value="${esc(r.supplier)}" placeholder="Not found"></label><label class="field">Supplier ABN<input name="supplierAbn" maxlength="20" value="${esc(r.supplierAbn)}" placeholder="Not found"></label></div><label class="field">Bank details<textarea name="supplierBankDetails" maxlength="3000" rows="4" placeholder="Not found">${esc(r.supplierBankDetails)}</textarea></label><button type="button" id="expense-check-abn">Check ABN</button><div id="expense-abn-result" aria-live="polite">${r.supplierAbnCheck?abnSummary(r.supplierAbnCheck):'<p class="muted">ABN not checked.</p>'}</div></details>`;
}
