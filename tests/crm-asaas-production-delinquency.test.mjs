import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {previewProductionCrmAsaasDelinquency,CRM_ASAAS_RECOMMENDED_GRACE_DAYS} from '../supabase/functions/_shared/crm-asaas-production-delinquency.mjs';
const sale={id:'sale-1',provider:'asaas',environment:'production',
  source:'site-captacao',billing_mode:'recurring',billing_cycle_months:1,
  sale_status:'provisioned',provisioned_at:'2026-10-01T00:00:00Z',
  product_id:'prod-crm',organization_id:'org-one',
  asaas_subscription_id:'sub_contract12345',
  provider_customer_id:'cus_contract12345',
  checkout_amount_cents:7900,registration_number:'12345678909'};
const access={id:'access-one',organization_id:'org-one',product_id:'prod-crm',
  billing_provider:'asaas',billing_mode:'recurring',billing_cycle_months:1,
  commercial_condition:'standard',subscription_status:'past_due',access_status:'active',
  external_tenant_id:'tenant-one',provider_subscription_id:'sub_contract12345',
  provider_customer_id:'cus_contract12345',contracted_price_cents:7900};
const eventRow={provider:'asaas',provider_event_id:'asaas:evt_grace12345',event_type:'PAYMENT_OVERDUE',
  payload:{event:'PAYMENT_OVERDUE',dateCreated:'2026-11-07T16:00:00-03:00',
    resource:{id:'pay_grace12345',subscription:'sub_contract12345',
      dueDate:'2026-11-01',billingType:'PIX',value:79,status:'OVERDUE'}}};
const invoice={id:'pay_grace12345',subscription:'sub_contract12345',
  customer:'cus_contract12345',value:79,billingType:'PIX',status:'OVERDUE',
  dueDate:'2026-11-01'};
const subscription={id:'sub_contract12345',customer:'cus_contract12345',
  cycle:'MONTHLY',billingType:'PIX',status:'ACTIVE',nextDueDate:'2026-12-01'};
const customer={id:'cus_contract12345',cpfCnpj:'12345678909'};
const scenario=(options={})=>previewProductionCrmAsaasDelinquency({
 sale:options.sale??sale,access:options.access??access,
 eventRow:options.eventRow??eventRow,invoice:options.invoice??invoice,
 subscription:options.subscription??subscription,customer:options.customer??customer,
 productCode:options.productCode??'crm',now:options.now??'2026-11-07T20:00:00Z',
 graceDays:options.graceDays??7,policyApproved:options.policyApproved??false,
});
test('proposed grace period is seven calendar days, never auto-suspends',()=>{
 assert.equal(CRM_ASAAS_RECOMMENDED_GRACE_DAYS,7);
 const a=scenario();assert.equal(a.decision,'hold');
 assert.equal(a.reason,'within_grace_period');
 assert.equal(a.daysLate,6);assert.equal(a.daysUntilReview,1);
 assert.equal(a.canSuspendCrm,false);
 assert.equal(a.canChargeCustomer,false);
 assert.equal(a.readOnly,true);
});
test('grace end still blocks suspension without policy approval',()=>{
 const a=scenario({now:'2026-11-08T16:00:00Z'});
 assert.equal(a.reason,'grace_policy_not_approved');
 assert.equal(a.daysLate,7);
 assert.equal(a.decision,'hold');
 assert.equal(a.canSuspendCrm,false);
});
test('even after policy approval only a manual REVIEW is possible, no mutations',()=>{
 const a=scenario({now:'2026-11-09T15:00:00Z',policyApproved:true});
 assert.equal(a.decision,'candidate_review');
 assert.equal(a.reason,'manual_suspension_review_required');
 assert.equal(a.requiresOperatorReview,true);
 assert.equal(a.canSuspendCrm,false);
});
test('late events, replay and cross-tenant or sandbox mismatches fail closed',()=>{
 const cases=[
  {sale:{...sale,environment:'sandbox'}},
  {sale:{...sale,organization_id:'foreign'}},
  {sale:{...sale,billing_cycle_months:12}},
  {sale:{...sale,sale_status:'checkout_created'}},
  {access:{...access,commercial_condition:'courtesy'}},
  {access:{...access,provider_subscription_id:'sub_other12345'}},
  {access:{...access,external_tenant_id:null}},
  {access:{...access,subscription_status:'cancelled'}},
  {access:{...access,provider_customer_id:'cus_other12345'}},
  {customer:{...customer,cpfCnpj:'11111111111'}},
  {invoice:{...invoice,customer:'cus_other12345'}},
  {invoice:{...invoice,value:89}},
  {invoice:{...invoice,subscription:'sub_other12345'}},
  {invoice:{...invoice,dueDate:'2026-11-06'}},
  {subscription:{...subscription,cycle:'YEARLY'}},
  {subscription:{...subscription,billingType:'BOLETO'}},
  {eventRow:{...eventRow,provider_event_id:'not-genuine'}},
  {eventRow:{...eventRow,payload:{...eventRow.payload,dateCreated:'invalid'}}},
  {access:{...access,provider_state_event_created_at:'2026-11-07T20:00:00Z'}},
  {productCode:'sst'},
 ];
 for(const arg of cases){const outcome=scenario(arg);
  assert.notEqual(outcome.decision,'candidate_review',JSON.stringify(arg));
  assert.equal(outcome.canSuspendCrm,false);
 }
});
test('a paid invoice cannot be suspended even if an older event said overdue',()=>{
 for(const state of ['RECEIVED','CONFIRMED']){
  const a=scenario({invoice:{...invoice,status:state},now:'2026-11-20T20:00:00Z',policyApproved:true});
  assert.equal(a.reason,'payment_resolved_by_renewal_flow');
  assert.equal(a.canSuspendCrm,false);
 }
});
test('refund, subscription deletion or inactive subscription never trigger immediate cut',()=>{
 const refunded=scenario({eventRow:{...eventRow,event_type:'PAYMENT_REFUNDED',
   payload:{...eventRow.payload,event:'PAYMENT_REFUNDED'}},
  invoice:{...invoice,status:'REFUNDED'},policyApproved:true,
  now:'2026-11-20T20:00:00Z'});
 assert.equal(refunded.reason,'refund_requires_manual_reconciliation');
 const deleted=scenario({eventRow:{...eventRow,event_type:'SUBSCRIPTION_DELETED',
  payload:{...eventRow.payload,event:'SUBSCRIPTION_DELETED',
    resource:{id:'sub_contract12345'}}}});
 assert.equal(deleted.reason,'subscription_change_requires_manual_confirmation');
 const inactive=scenario({subscription:{...subscription,status:'INACTIVE'},
   now:'2026-11-20T20:00:00Z',policyApproved:true});
 assert.equal(inactive.reason,'inactive_subscription_manual_review_only');
 for(const obj of [refunded,deleted,inactive])assert.equal(obj.canSuspendCrm,false);
});
test('invalid clock, missing provider proof and unreasonable grace windows are held',()=>{
 for(const change of [
  {now:'not-a-time'}, {graceDays:0},{graceDays:31},
  {eventRow:{...eventRow,payload:{...eventRow.payload,resource:{id:'pay_grace12345'}}}},
  {invoice:{...invoice,status:'PENDING'}},
  {subscription:{...subscription,status:'UNKNOWN'}},
 ]) {
  const result=scenario(change);
  assert.notEqual(result.decision,'candidate_review');
  assert.equal(result.canSuspendCrm,false);
 }
});
test('pure policy does not have network access, secrets, database or billing mutations',()=>{
 const src=readFileSync(new URL('../supabase/functions/_shared/crm-asaas-production-delinquency.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(src,/\bfetch\(|Deno\.env|createClient\(|\.rpc\(|\.(?:insert|update|upsert|delete)\(/);
 assert.doesNotMatch(src,/sendCrm|provisionCrm|stripe-webhook|\/v3\/payments/);
 assert.match(src,/requiresOperatorReview:true/);
 assert.match(src,/canSuspendCrm:false,canChargeCustomer:false/);
});
