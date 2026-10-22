// Conservative label-based extraction. Every result is a candidate for human review.
const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
const months = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
export function parseDate(value) {
  const s = value.trim(); let y,m,d,match;
  if ((match=s.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/))) [,y,m,d]=match;
  else if ((match=s.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})\b/))) [,d,m,y]=match;
  else if ((match=s.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\s*,?\s*(20\d{2})\b/))) {d=match[1];m=months.indexOf(match[2].slice(0,3).toLowerCase())+1;y=match[3];}
  else if ((match=s.match(/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s*(20\d{2})\b/))) {m=months.indexOf(match[1].slice(0,3).toLowerCase())+1;d=match[2];y=match[3];}
  else return null;
  const date = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  return +m>0 && +m<=12 && +d>0 && +d<=31 && new Date(date+'T12:00:00Z').toISOString().slice(0,10)===date ? date : null;
}
function amounts(text) {
  if(/\d+\.\d{3},\d{2}/.test(text))return [];
  const clean=text.replace(/\d+(?:\.\d+)?\s*%/g,'');
  const matches=[...clean.matchAll(/(?:AUD|USD|NZD|EUR|GBP|A\$|AU\$|US\$|\$|€|£)?\s*(-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{2})?)(?![\d.])/gi)];
  return matches.map(m=>Number(m[1].replaceAll(',',''))).filter(Number.isFinite);
}
export function parseInvoice(text) {
  const lines = text.replaceAll('\r','').split('\n').map(s=>s.trim()).filter(Boolean);
  const fields={supplier:'',reference:'',date:'',dueDate:'',abn:'',currency:'',subtotal:null,tax:null,total:null};
  const evidence={};const warnings=[];
  const set=(key,value,line,kind='label')=>{fields[key]=value;evidence[key]={text:line,kind};};
  const dateToken=/(?:20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]20\d{2}|\d{1,2}\s+[A-Za-z]{3,9}\s*,?\s*20\d{2}|[A-Za-z]{3,9}\s+\d{1,2},?\s*20\d{2})/;
  for(let i=0;i<lines.length;i++) {
    const line=lines[i];
    for(const [key,label] of [['dueDate',/\b(?:due\s*date|payment\s+due|due\s+on)\s*[:#-]?\s*/i],['date',/\b(?:invoice\s*date|date\s+of\s+issue|issue\s*date|issued\s+on|date)\s*[:#-]?\s*/i]]) {
      if(key==='date' && /due\s*date/i.test(line) && !/invoice\s*date/i.test(line))continue;
      const m=label.exec(line);if(!m)continue;
      const after=line.slice(m.index+m[0].length);const token=(after.match(dateToken)||(!after.trim()?lines[i+1]?.match(dateToken):null))?.[0];
      const value=token&&parseDate(token);if(value)set(key,value,line+(after?'':' '+(lines[i+1]||'')));
    }
    const ref=line.match(/\b(?:invoice\s*(?:number|no\.?|#|ref(?:erence)?\.?|id)|tax\s+invoice\s*(?:no\.?|#))\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9/_.-]*)/i);
    if(ref&&!/^(date|number|invoice|no)$/i.test(ref[1]))set('reference',ref[1],line);
    else if(/^(?:invoice\s*(?:number|no\.?|#|ref(?:erence)?|id))\s*[:#]?$/i.test(line)&&/^[A-Z0-9][A-Z0-9/_-]{2,}$/i.test(lines[i+1]||''))set('reference',lines[i+1],line+' '+lines[i+1]);
    const abn=line.match(/\bABN\s*[:#]?\s*((?:\d[ -]?){11})\b/i);if(abn)set('abn',abn[1].replace(/\D/g,''),line);
    const supplier=line.match(/^(?:supplier|vendor|from|issued\s+by)\s*:\s*(.{2,120})$/i);if(supplier)set('supplier',supplier[1].trim(),line);
  }
  if(!fields.supplier) {
    // Header-only candidate, never a company under Bill To / Ship To.
    const cutoff=lines.findIndex(l=>/\b(?:bill(?:ed)?\s+to|ship\s+to|invoice\s*(?:number|no|#|date)|customer)\b/i.test(l));
    const header=lines.slice(0,cutoff<0?Math.min(6,lines.length):cutoff);
    const candidate=header.find(l=>/\b(?:pty\.?\s+ltd\.?|limited|ltd\.?|inc\.?|llc)\b/i.test(l))||header.find(l=>/[A-Za-z]{3}/.test(l)&&!/(invoice|statement|receipt|abn|date|tax|www\.|@|tel:|phone|page\s*\d)/i.test(l)&&l.length<85&&!/^\d/.test(l));
    if(candidate)set('supplier',candidate.replace(/\s{3,}.*$/,''),candidate,'header candidate');
  }
  const currencyMatches=[...text.matchAll(/\b(AUD|USD|NZD|EUR|GBP|CAD|SGD|CNY|RMB|JPY|HKD)\b|\b(AU|US|NZ|CA|SG|HK)\$|€|£/g)].map(m=>m[1]||({AU:'AUD',US:'USD',NZ:'NZD',CA:'CAD',SG:'SGD',HK:'HKD'}[m[2]])||(m[0]==='€'?'EUR':'GBP'));
  const currencies=[...new Set(currencyMatches)];
  if(currencies.length===1)set('currency',currencies[0],currencies[0]);
  else if(currencies.length>1)warnings.push('Multiple currencies appear in the invoice. Check the invoice currency.');
  else warnings.push('Currency was not found. A dollar sign alone does not confirm AUD.');
  // Match exact summary labels; never treat "Subtotal", "Total GST" or "Balance due" as invoice total.
  const labels={subtotal:/^(?:sub\s*-?\s*total|total\s+(?:ex(?:cluding)?\.?\s*(?:gst|tax)|before\s+(?:gst|tax))|net\s+(?:amount|total))\b\s*[:=]?/i,
    tax:/^(?:(?:total\s+)?(?:gst|vat|tax)(?:\s+(?:amount|total))?|(?:includes|including)\s+(?:gst|tax))\b\s*(?:\(?\d+(?:\.\d+)?\s*%\)?)?\s*[:=]?/i,
    total:/^(?:grand\s+total|invoice\s+total|total\s+(?:amount|incl(?:uding)?\.?\s*(?:gst|tax))|total)\b\s*[:=]?/i};
  const ambiguous=new Set();
  for(const [key,label] of Object.entries(labels)) {
    const candidates=[];
    for(let i=0;i<lines.length;i++) {
      const line=lines[i],m=line.match(label);if(!m)continue;
      const remainder=line.slice(m[0].length);
      if(key==='total'&&/^\s*(?:gst|tax|vat|excl|ex\b|before|paid|due|discount|items|quantity)/i.test(remainder))continue;
      if(key==='tax'&&/^(?:tax\s+invoice|tax\s+rate|tax\s+id)/i.test(line))continue;
      let values=amounts(remainder),source=line;
      if(!values.length&&/^[\s:()A-Z$€£%0-9.-]*$/.test(remainder)&&i+1<lines.length&&/^\s*(?:(?:AUD|USD|NZD|EUR|GBP|A\$|\$|€|£)\s*)?[\d,.]+\s*$/.test(lines[i+1])) {values=amounts(lines[i+1]);source+=' '+lines[i+1];}
      if(values.length)candidates.push({value:values.at(-1),source});
    }
    const distinct=[...new Set(candidates.map(c=>c.value))];
    if(distinct.length===1)set(key,candidates.at(-1).value,candidates.at(-1).source);
    else if(distinct.length>1){ambiguous.add(key);warnings.push(`Several different ${key} amounts were found. Enter the correct invoice amount.`);}
  }
  if(fields.total!==null&&fields.tax!==null&&fields.subtotal===null&&!ambiguous.has('subtotal')&&fields.total>=fields.tax) {
    set('subtotal',round(fields.total-fields.tax),'Invoice total − stated tax','calculated');
  }
  if(fields.subtotal!==null&&fields.tax!==null&&fields.total===null&&!ambiguous.has('total')) {
    set('total',round(fields.subtotal+fields.tax),'Stated subtotal + stated tax','calculated');
  }
  if(fields.subtotal!==null&&fields.tax!==null&&fields.total!==null&&Math.abs(round(fields.subtotal+fields.tax)-fields.total)>.01)warnings.push('Subtotal + GST does not match the invoice total. Check discounts, shipping or other adjustments.');
  if(fields.currency&&fields.currency!=='AUD')warnings.push(`${fields.currency} detected. This workspace currently supports AUD only; no currency conversion is performed.`);
  if(/\b(?:credit\s+note|credit\s+memo)\b/i.test(text))warnings.push('This appears to be a credit note. Credit notes are not supported by the Bill importer.');
  if([fields.subtotal,fields.tax,fields.total].some(n=>n!==null&&n<0))warnings.push('Negative amounts require manual review; this Bill importer only supports non-negative amounts.');
  if(/\b\d{1,2}[/.]\d{1,2}[/.]20\d{2}\b/.test(text))warnings.push('Numeric dates were read as day/month/year. Check both dates.');
  const missing=Object.entries(fields).filter(([k,v])=>!['abn','dueDate'].includes(k)&&(v===''||v===null)).map(([k])=>k);
  return {fields,evidence,warnings,missing};
}
