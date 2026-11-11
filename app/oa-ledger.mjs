// Only planned payment records contribute to payable totals. A budget or quote
// is not a debt; cancelled instalments must never inflate the outstanding sum.
export function paymentTotals(request){
 const payments=request.payments||[];
 const cents=p=>Math.round((Number(p.amount)||0)*100);
 return {
  scheduled:payments.some(p=>p.status!=='Cancelled'),
  paid:payments.filter(p=>p.status==='Paid').reduce((n,p)=>n+cents(p),0)/100,
  outstanding:payments.filter(p=>['Pending','Review','Ready'].includes(p.status)).reduce((n,p)=>n+cents(p),0)/100
 };
}
export function ledgerTotals(requests){
 return requests.reduce((sum,r)=>{const t=paymentTotals(r);return {paid:Math.round((sum.paid+t.paid)*100)/100,outstanding:Math.round((sum.outstanding+t.outstanding)*100)/100};},{paid:0,outstanding:0});
}
