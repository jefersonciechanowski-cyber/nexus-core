import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  CRM_ASAAS_POLICY_APPROVED,
  CRM_ASAAS_RECOMMENDED_GRACE_DAYS,
  previewProductionCrmAsaasDelinquency,
} from '../supabase/functions/_shared/crm-asaas-production-delinquency.mjs';

const preview=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-production-lifecycle-preview/index.ts',import.meta.url),'utf8');
const policyDoc=readFileSync(new URL('../docs/CRM_ASAAS_PRODUCTION_DELINQUENCY_REVIEW_20261107.md',import.meta.url),'utf8');

const contract={
  id:'crm-prod-sale-1',provider:'asaas',environment:'production',
  source:'site-captacao',billing_mode:'recurring',billing_cycle_months:1,
  sale_status:'provisioned',provisioned_at:'2026-10-01T00:00:00Z',
  product_id:'crm-product',organization_id:'company-1',
  asaas_subscription_id:'sub_contract12345',
  provider_customer_id:'cus_contract12345',checkout_amount_cents:7900,
  registration_number:'12345678909',
};
const access={
  id:'access-1',product_id:'crm-product',organization_id:'company-1',
  billing_provider:'asaas',billing_mode:'recurring',billing_cycle_months:1,
  commercial_condition:'standard',external_tenant_id:'crm-tenant-1',
  subscription_status:'past_due',access_status:'active',
  provider_subscription_id:'sub_contract12345',
  provider_customer_id:'cus_contract12345',contracted_price_cents:7900,
};
const event={
  provider:'asaas',provider_event_id:'asaas:evt_overdue12345',
  event_type:'PAYMENT_OVERDUE',
  payload:{
    event:'PAYMENT_OVERDUE',dateCreated:'2026-11-07T14:00:00-03:00',
    resource:{
      id:'pay_due123456',subscription:'sub_contract12345',
      billingType:'PIX',value:79,dueDate:'2026-11-01',
    },
  },
};
const invoice={
  id:'pay_due123456',subscription:'sub_contract12345',
  customer:'cus_contract12345',value:79,billingType:'PIX',status:'OVERDUE',
  dueDate:'2026-11-01',
};
const subscription={
  id:'sub_contract12345',customer:'cus_contract12345',cycle:'MONTHLY',
  billingType:'PIX',status:'ACTIVE',nextDueDate:'2026-12-01',
};
const customer={id:'cus_contract12345',cpfCnpj:'12345678909'};
function assess(now,override={}){
 return previewProductionCrmAsaasDelinquency({
   eventRow:event,sale:contract,access,invoice,subscription,customer,
   productCode:'crm',now,graceDays:CRM_ASAAS_RECOMMENDED_GRACE_DAYS,
   policyApproved:CRM_ASAAS_POLICY_APPROVED,...override,
 });
}

test('operator approved exactly 7 calendar days; grace still grants access',()=>{
 assert.equal(CRM_ASAAS_POLICY_APPROVED,true);
 assert.equal(CRM_ASAAS_RECOMMENDED_GRACE_DAYS,7);
 const before=assess('2026-11-07T20:00:00Z');
 assert.equal(before.decision,'hold');
 assert.equal(before.reason,'within_grace_period');
 assert.equal(before.daysLate,6);
 assert.equal(before.daysUntilReview,1);
 assert.equal(before.canSuspendCrm,false);
});
test('at day seven overdue becomes manual-review candidate ONLY',()=>{
 const due=assess('2026-11-08T20:00:00Z');
 assert.equal(due.decision,'candidate_review');
 assert.equal(due.reason,'manual_suspension_review_required');
 assert.equal(due.daysLate,7);
 assert.equal(due.requiresOperatorReview,true);
 assert.equal(due.canSuspendCrm,false);
 assert.equal(due.canChargeCustomer,false);
 assert.equal(due.readOnly,true);
});
test('confirmed payment vetoes suspension even when grace expired',()=>{
 const result=assess('2026-11-12T20:00:00Z',{
  invoice:{...invoice,status:'RECEIVED'},
 });
 assert.equal(result.decision,'hold');
 assert.equal(result.reason,'payment_resolved_by_renewal_flow');
 assert.equal(result.canSuspendCrm,false);
});
test('approval must not bypass tenant identity, terminal cancellation or replay checks',()=>{
 for(const changes of [
  {sale:{...contract,environment:'sandbox'}},
  {access:{...access,subscription_status:'cancelled'}},
  {access:{...access,organization_id:'different-company'}},
  {eventRow:{...event,provider_event_id:'wrong'}},
  {invoice:{...invoice,customer:'cus_another12345'}},
  {access:{...access,provider_state_event_created_at:'2026-11-07T17:00:00Z'}},
 ]){
  const result=assess('2026-11-12T20:00:00Z',changes);
  assert.notEqual(result.decision,'candidate_review');
  assert.equal(result.canSuspendCrm,false);
 }
});
test('preview accepts unpaid overdue without pretending it has a payment receipt',()=>{
 assert.match(preview,/eventRow\.event_type!=='PAYMENT_OVERDUE'/);
 assert.match(preview,/if\(eventRow\.event_type\?\.startsWith\('PAYMENT_'\)/);
 assert.match(preview,/previewProductionCrmAsaasDelinquency\(\{/);
 assert.match(preview,/policyApproved:CRM_ASAAS_POLICY_APPROVED/);
 assert.match(preview,/\.eq\('provider','asaas'\)\.eq\('provider_payment_id',resource\.id\)/);
 const receiptGuard=preview.indexOf("eventRow.event_type!=='PAYMENT_OVERDUE'");
 const receiptQuery=preview.indexOf(".from('nexus_payments')");
 assert.ok(receiptGuard>0&&receiptQuery>receiptGuard);
});
test('lifecycle endpoint remains hard off and never mutates Central or CRM',()=>{
 assert.match(preview,/const STAGED_ASAAS_PROD_LIFECYCLE_DISABLED = true/);
 assert.match(preview,/if\(STAGED_ASAAS_PROD_LIFECYCLE_DISABLED\)/);
 assert.match(preview,/policyApproved:CRM_ASAAS_POLICY_APPROVED/);
 assert.doesNotMatch(preview,/admin\.rpc\(|\.insert\(|\.update\(|\.delete\(|sendCrmAccessEmail\(/);
 assert.match(policyDoc,/política aprovada/i);
 assert.match(policyDoc,/revisão administrativa/i);
 assert.match(policyDoc,/aviso de atraso/i);
 assert.match(policyDoc,/não suspenderá o CRM automaticamente/i);
});
