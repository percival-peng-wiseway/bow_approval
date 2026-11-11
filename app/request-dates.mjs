const formatter = new Intl.DateTimeFormat('en-CA', {timeZone:'Australia/Melbourne',year:'numeric',month:'2-digit',day:'2-digit'});
export function requestDate(value) {
  if(value == null || value === '') return '';
  const instant = new Date(value);
  return Number.isNaN(instant.valueOf()) ? '' : formatter.format(instant);
}
export function requestDateRange(period, from='', to='', now=new Date()) {
  if(period==='custom') return {from,to};
  const today=requestDate(now), [year,month]=today.split('-').map(Number);
  if(period==='month') return {from:today.slice(0,7)+'-01',to:today};
  if(period==='previous') {
    const start=new Date(Date.UTC(year,month-2,1)), end=new Date(Date.UTC(year,month-1,0));
    return {from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10)};
  }
  return {from:'',to:''};
}
export function matchesRequestDate(request,range) {
  if(!range.from&&!range.to) return true;
  if(range.from&&range.to&&range.from>range.to) return false;
  const day=requestDate(request.createdAt);
  return !!day&&(!range.from||day>=range.from)&&(!range.to||day<=range.to);
}
