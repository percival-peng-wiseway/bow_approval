// Visual specification of the current business.mjs / customer-domain.mjs rules.
// Layout edits never mutate the approval engine or a submitted request's route.
import {users,money} from './domain.mjs';
export const approvalVersion='v1';
export const approvalKinds={corporation:'Company expenses',reimbursement:'Project reimbursements',service:'Project services'};
export function approvalGraph(kind,project=null){
 const person=id=>users.find(u=>u.id===id)?.name||id;
 const pm=project?person(project.pm):'Project PM',director=project?person(project.director):'Project Director';
 const threshold=project?project.threshold:10000;
 const nodes=[],edges=[];
 const n=(id,title,owner,detail,row,col=1,type='step')=>nodes.push({id,title,owner,detail,x:70+(col-1)*290,y:32+row*158,type});
 const e=(from,to,label='',side='')=>edges.push({from,to,label,side});
 const common=[
  ['Independent approval','Applicants cannot approve their own requests. When a reviewer is the applicant, an independent Director handles that review. Service gates use Admin instead of Finance when Finance is the applicant, and an independent Director for the Director vote.'],
  ['Return for changes','A reason is required. Supplier review returns to supplier preparation; payment review and acceptance return to payment documents. Other returns require resubmission. Relevant approvals are cleared.'],
  ['Withdraw / cancel','Only the applicant can withdraw before any payment is recorded. Cancellation stops unpaid instalments and preserves paid records. Editing invalidates previous approvals.'],
  ['Project settings','PM, Director and the threshold are captured on submission. Later project changes do not rewrite an existing request’s route.']
 ];
 if(kind==='corporation'||kind==='reimbursement'){
  n('submit','Submit expense','Applicant','Amount, expense date and receipt / supporting evidence.',0,1,'start');
  if(kind==='corporation'){
   n('review','Company review','Kate + Lewis','Admin and Finance must both approve; either may review first. Independent approval applies if one is the applicant.',1);
   n('paid','Record reimbursement','Lewis · Finance','Record payment method, actual date, reference and proof. No money is transferred by this system.',2);
   n('completed','Completed','','Paid record and evidence retained.',3,1,'end');
   nodes[0].owner='PM / Admin / Finance / Director';nodes[0].detail='Expense name, amount, date and invoice / receipt. Only PM, Admin, Finance and Directors can submit. No supervisor review.';
   e('submit','review');e('review','paid','Both approved');e('paid','completed');
  }else{
   n('pm','PM review',pm,'The project PM reviews staff reimbursement evidence. An independent Director handles a review if the PM is the applicant.',1);
   n('threshold','Amount > AUD 2,000?','Per reimbursement','Strictly above AUD 2,000 triggers a separate Director acknowledgement. It is not an approval gate.',2,1,'condition');
   n('notice','Notify Project Director',director,'Create an acknowledgement task for the Director and continue immediately to Finance. The Director confirms awareness separately; Finance and payment never wait for acknowledgement.',3,2,'action');
   n('finance','Finance review','Lewis · Finance','Review the reimbursement before payment. No automatic Director approval is required.',4);
   n('paid','Record reimbursement','Lewis · Finance','Record actual payment details and proof. Director acknowledgement does not hold payment.',5);
   n('completed','Completed','','Paid record and evidence retained. An outstanding Director acknowledgement remains available until acknowledged.',6,1,'end');
   e('submit','pm');e('pm','threshold');e('threshold','notice','Yes');e('threshold','finance','No','left');e('notice','finance','Continue immediately');e('finance','paid','Approved');e('paid','completed');
  }
 }else if(kind==='service'){
  n('submit','Submit service','Applicant','Service, background, delivery format, estimated budget, paying legal entity and cost code.',0,1,'start');
  n('notify','Customer confirmation?','Optional on request','If Notify customer is selected, an active linked customer confirms before internal pre-approval.',1,1,'condition');
  n('customer','Customer confirmation','Project customer','Approve → internal pre-approval. Changes requested or declined → applicant revises and resubmits; a new confirmation version is created.',2,2);
  n('budget','Budget pre-approval',`Lewis + ${director}`,'Finance and Project Director approve. Above AUD 5,000 including GST, the other two Directors must also approve. Self-approval is excluded.',3);
  n('sourcing','Quotes & supplier selection','Applicant','Upload supplier quotes, choose a supplier and explain the selection.',4);
  n('over','Above approved budget?','Selected supplier total','If the chosen supplier exceeds the approved budget, repeat budget approval.',5,1,'condition');
  n('increase','Budget increase',`Lewis + ${director}`,'Reassess the revised service total: above AUD 5,000, include the other two Directors. All required reviewers approve. If it exceeds the customer-confirmed amount, get a new customer confirmation first. Then continue to quote / contract approval.',6,2);
  n('supplier','Supplier approval',`Lewis + ${director}`,'Finance and Project Director approve the supplier upper price. Above AUD 5,000 including GST, the other two Directors also approve. Supplier credit / reputation screening is planned for a later release and is not currently performed.',7);
  n('contract','Prepare service contract','Applicant','The requester uploads the service contract. Optional Luna analysis extracts ABN, payment information and buyer-side review points. Submit the contract to Finance.',8);
  n('contract-review','Contract review','Lewis · Finance','Approve the contract before setting a payment schedule, or return it to the applicant for changes.',9);
  n('signing','Record signed contract','Applicant','Upload the executed agreement, authorised signatory and actual signing date. Capture paying entity and optional defects period end.',10);
  n('invoice','Upload supplier invoice','Applicant','After signing, upload the invoice, check its ABN and enter the invoice supplier and payment details.',11,1,'action');
  n('invoice-review','Invoice & supplier review','Lewis · Finance','Review invoice ABN, identity, amount and payment details. Save approved supplier details before payment setup.',12);
  n('change','Contract variation requested?','After signing','A separate change record preserves the original agreement and paid milestones.',11,1,'condition');
  n('variation','Variation approval',`Lewis + ${director}`,'All required reviewers approve scope, price and time impact; the revised service total above AUD 5,000 also requires the other two Directors. Attach written customer consent if the original request required customer confirmation.',12,2);
  n('variation-sign','Record signed variation','Applicant','Record the signed variation. Keep paid instalments; replan only the revised unpaid balance.',13,2,'action');
  n('bank','Verify payment destination','Lewis · Finance','Record independent verification using a trusted contact or supplier portal.',14,1,'action');
  n('plan','Set payment schedule','Lewis · Finance','Schedule the unpaid balance as Deposit / advance, Progress, Final or Retention. Only retention may follow Final.',15);
  n('documents','Upload payment documents','Applicant','Select an approved invoice for this instalment and attach delivery / advance evidence. A new invoice must pass ABN and Finance review first; one invoice can cover multiple instalments within its total.',16);
  n('delivery','PM delivery verification',pm,'Verify each milestone or contractual advance basis. Independent Director handles the review if the PM is the applicant.',17);
  n('final','Last / final / retention payment?','Payment type and schedule','Every last instalment needs Project Director release, even an advance or progress payment. Final and retention additionally require completion / defects acceptance.',18,1,'condition');
  n('acceptance','Project Director sign-off',director,'Release the last payment. For Final / Retention verify completion; retention cannot be released before its release date. Approving an advance does not mark work completed.',19,2);
  n('payment-review','Payment review','Lewis · Finance','Review evidence after PM verification and any required Director acceptance.',20);
  n('paid','Record payment','Lewis · Finance','Record an actual external payment with reference, date and proof. This workspace does not transfer money.',21);
  n('remaining','More instalments?','','Return to the next invoice. A variation can also be requested while awaiting payment documents.',22,1,'condition');
  n('completion-check','Completion already accepted?','Director acceptance','Paying all invoices does not, by itself, prove service completion.',23,1,'condition');
  n('completion-docs','Upload completion evidence','Applicant','Required when all payments were advances or progress payments without final acceptance.',24,2,'action');
  n('completion-pm','Verify completion',pm,'Confirm actual completion and any resolved defects.',25,2);
  n('completion-director','Completion sign-off',director,'Confirm final completion before closing the service.',26,2);
  n('completed','Completed','','Payments and completion evidence retained.',27,1,'end');
  n('lodge','Publish completion','Project team','Explicitly publish selected deliverables to the customer archive.',28);
  for(const node of nodes)if(!['invoice','invoice-review'].includes(node.id)&&node.y>=32+11*158)node.y+=2*158;
  e('submit','notify');e('notify','customer','Yes');e('notify','budget','No','left');e('customer','budget','Confirmed');e('budget','sourcing','All required approvals');e('sourcing','over');e('over','increase','Yes');e('over','supplier','No','left');e('increase','supplier','Budget approved');e('supplier','contract','All required approvals');e('contract','contract-review','Submit');e('contract-review','signing','Finance approved');e('signing','invoice');e('invoice','invoice-review');e('invoice-review','change','Invoice approved');e('change','variation','Yes');e('change','bank','No','left');e('variation','variation-sign','All required approvals');e('variation-sign','bank');e('bank','plan');e('plan','documents');e('documents','delivery');e('delivery','final');e('final','acceptance','Yes');e('final','payment-review','No','left');e('acceptance','payment-review','Approved');e('payment-review','paid','Approved');e('paid','remaining');e('remaining','documents','Yes · next instalment','left');e('remaining','completion-check','No');e('completion-check','completed','Yes','left');e('completion-check','completion-docs','No');e('completion-docs','completion-pm');e('completion-pm','completion-director');e('completion-director','completed');e('completed','lodge','With customer confirmation');
 }else throw new Error('Unknown workflow type');
 if(kind==='service'){common[2]=['Withdraw / cancel','Before contract signing, the applicant can withdraw or cancel. After signing, use a variation for changes. Formal contract termination is not implemented.'];common[3]=['Versioning','New service requests use v2. Existing routes and paid history remain captured. Pending budget/supplier/variation gates apply the additional Director rule. Saved designs do not automatically change the live engine.'];}
 const exceptions=kind==='corporation'?common.filter(([label])=>label!=='Project settings'):[...common,['Director escalation','Finance or Admin can refer eligible project stages to an independent Director with a reason. After approval, the request resumes the stage it came from. Initial budget review and customer confirmation use their own approval gates.']];
 return {version:kind==='service'?'v2':approvalVersion,kind,title:approvalKinds[kind],nodes,edges,exceptions};
}
