// Re-rendering a view should not move the user away from the control they used.
const scrollContainers=['.sidebar','.main','#business-page','.business-list','.business-detail','.request-list','.detail-body','.page','.graph-scroll'];
export function captureViewPosition(root) {
 const positions=scrollContainers.flatMap(selector=>[...root.querySelectorAll(selector)].map((el,index)=>({selector,index,top:el.scrollTop,left:el.scrollLeft})));
 const active=document.activeElement;
 let focusSelector=null;
 if(root.contains(active)) {
  if(active.id)focusSelector='#'+CSS.escape(active.id);
  else for(const attr of ['data-business-view','data-business-request','data-project-list-kind','data-biz','data-action','data-page','name']) {
   if(active.hasAttribute(attr)){focusSelector=`[${attr}="${CSS.escape(active.getAttribute(attr))}"]`;break;}
  }
 }
 return {positions,focusSelector};
}
export function restoreViewPosition(root,snapshot) {
 if(!snapshot)return;
 const focus=snapshot.focusSelector&&root.querySelector(snapshot.focusSelector);
 if(focus&&!focus.disabled)focus.focus({preventScroll:true});
 for(const {selector,index,top,left} of snapshot.positions) {
  const el=root.querySelectorAll(selector)[index];
  if(el){el.scrollTop=top;el.scrollLeft=left;}
 }
}
