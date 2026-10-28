import test from 'node:test';
import assert from 'node:assert/strict';
import { decideCrmAsaasLifecycle } from '../supabase/functions/_shared/crm-asaas-lifecycle.mjs';

const now='2026-10-26T15:00:00.000Z';
const earlier='2026-10-26T14:58:00.000Z';
const sale={provider:'asaas',environment:'sandbox',billing_mode:'recurring',
  billing_cycle_months:1,organization_id:'org-one',asaas_subscription_id:'sub_valid123'};
const access={billing_provider:'asaas',billing_mode:'recurring',commercial_condition:'standard',
  product_code:'crm',organization_id:'org-one',provider_subscription_id:'sub_valid123',
  subscription_status:'active',provider_state_event_created_at:'2026-10-25T15:00:00.000Z',
  provider_state_event_id:'asaas:evt_previous123',knownProviderPaymentId:'pay_valid123',
  contracted_price_cents:7900};
const payment={id:'pay_valid123',subscription:'sub_valid123',value:79,status:'RECEIVED'};
const subscription={id:'sub_valid123',status:'ACTIVE'};
const mkEvent=(type,id=type.toLowerCase().replace(/_/g,''))=>({
  provider:'asaas',provider_event_id:'asaas:evt_'+id+'123456789',
  event_type:type,occurredAt:earlier,relatedPaymentId:'pay_valid123',
  payload:{event:type,resource:{id:type.startsWith('SUBSCRIPTION_')?'sub_valid123':'pay_valid123'}},
});
const apply=(type,overrides={})=>decideCrmAsaasLifecycle({
  event:mkEvent(type),sale,access,payment,subscription,now,...overrides,
});

test('confirmed, independently linked monthly payment can only propose reactivation',()=>{
  const result=apply('PAYMENT_RECEIVED',{access:{...access,subscription_status:'past_due'}});
  assert.deepEqual([result.decision,result.action,result.subscriptionStatus,result.accessStatus],
    ['candidate','reactivate','active','active']);
  assert.equal(Object.hasOwn(result,'tenant'),false);
});
test('overdue never suspends automatically without agreed grace policy',()=>{
  const result=apply('PAYMENT_OVERDUE',{payment:{...payment,status:'OVERDUE'}});
  assert.deepEqual([result.decision,result.reason],['hold','await_explicit_grace_policy']);
});
test('a refund, if verified at provider NOW, proposes suspension without deleting tenant',()=>{
  const result=apply('PAYMENT_REFUNDED',{payment:{...payment,status:'REFUNDED'}});
  assert.deepEqual([result.decision,result.action,result.subscriptionStatus,result.accessStatus],
    ['candidate','suspend','past_due','suspended']);
  assert.equal(apply('PAYMENT_REFUNDED').decision,'manual_review');
});
test('subscription inactivated vs deleted are different and require provider evidence',()=>{
  const inactive=apply('SUBSCRIPTION_INACTIVATED',{subscription:{...subscription,status:'INACTIVE'}});
  assert.deepEqual([inactive.decision,inactive.action],['candidate','suspend']);
  assert.equal(apply('SUBSCRIPTION_INACTIVATED').reason,'inactive_not_independently_verified');
  assert.equal(apply('SUBSCRIPTION_DELETED').reason,'deletion_not_independently_verified');
  const deleted=apply('SUBSCRIPTION_DELETED',{subscription:null,verifiedDeletion:true});
  assert.deepEqual([deleted.decision,deleted.action,deleted.subscriptionStatus],
    ['candidate','cancel','cancelled']);
});
test('cancelled subscription is terminal against older paid/refund/inactive events',()=>{
  for(const type of ['PAYMENT_RECEIVED','PAYMENT_REFUNDED','SUBSCRIPTION_INACTIVATED']){
    assert.equal(apply(type,{access:{...access,subscription_status:'cancelled'}}).decision,'hold');
  }
});
test('stale/replayed/future events cannot undo a suspension or cancellation',()=>{
  assert.equal(apply('PAYMENT_RECEIVED',{access:{...access,provider_state_event_created_at:now}}).reason,'stale_or_duplicate');
  assert.equal(apply('PAYMENT_RECEIVED',{event:{...mkEvent('PAYMENT_RECEIVED'),occurredAt:'2026-11-01T00:00:00.000Z'}}).reason,'bad_event_time');
  assert.equal(apply('PAYMENT_RECEIVED',{access:{...access,provider_state_event_id:mkEvent('PAYMENT_RECEIVED').provider_event_id}}).reason,'duplicate');
});
test('agency courtesies, founder accounts, wrong orgs and Stripe contracts cannot be affected',()=>{
  for(const changed of [
    {commercial_condition:'courtesy'},{commercial_condition:'founder'},
    {billing_provider:'stripe'},{organization_id:'another_org'},
    {product_code:'sst'},{provider_subscription_id:'sub_other'},
  ]){
    assert.equal(apply('PAYMENT_REFUNDED',{access:{...access,...changed}}).reason,'contract_not_eligible_or_courtesy');
  }
  assert.equal(apply('PAYMENT_RECEIVED',{sale:{...sale,environment:'production'}}).decision,'manual_review');
});
test('wrong amount, paid owner, invoice or provider status fails closed',()=>{
  for(const changed of [{value:119},{subscription:'sub_other'},{id:'pay_other'}]){
    assert.equal(apply('PAYMENT_RECEIVED',{payment:{...payment,...changed}}).decision,'manual_review');
  }
  assert.equal(apply('PAYMENT_RECEIVED',{access:{...access,knownProviderPaymentId:'pay_other'}}).decision,'manual_review');
  assert.equal(apply('PAYMENT_RECEIVED',{payment:{...payment,status:'REFUNDED'}}).reason,'paid_state_not_independently_verified');
  assert.equal(apply('PAYMENT_RECEIVED',{subscription:{...subscription,status:'INACTIVE'}}).reason,'paid_state_not_independently_verified');
});
test('chargeback and unknown event types trigger manual review or hold',()=>{
  assert.equal(apply('PAYMENT_CHARGEBACK_REQUESTED').decision,'manual_review');
  assert.equal(apply('SUBSCRIPTION_UPDATED').decision,'hold');
});
