import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyCrmAsaasSettlement } from '../supabase/functions/_shared/crm-asaas-reconciliation.mjs';
const sale = {
  id: 'ad196d02-8101-4177-8fa1-563a8712102f', provider: 'asaas',
  environment: 'sandbox', sale_status: 'checkout_created', billing_mode: 'recurring',
  billing_cycle_months: 1, checkout_amount_cents: 7900, asaas_checkout_id: 'plink_123',
  asaas_subscription_id: null,
};
const link = { id: 'plink_123', chargeType: 'RECURRENT', subscriptionCycle: 'MONTHLY', billingType: 'PIX', value: 79 };
const payment = { id: 'pay_123456789', paymentLink: 'plink_123', subscription: 'sub_98765', status: 'RECEIVED', billingType: 'PIX', value: 79 };
const event = { provider: 'asaas', event_type: 'PAYMENT_RECEIVED', payload: { event: 'PAYMENT_RECEIVED', resource: payment } };
const run = (e = event, s = sale, l = link) => classifyCrmAsaasSettlement(e,s,l);

test('correct monthly Pix payment can only become reconciliation candidate, never activate CRM', () => {
  const outcome = run();
  assert.equal(outcome.decision, 'candidate_for_manual_verified_reconciliation');
  assert.equal(outcome.saleId, sale.id);
  assert.equal(outcome.paymentId, payment.id);
  assert.equal(outcome.amountCents, 7900);
  assert.equal(Object.hasOwn(outcome, 'activateCrm'), false);
});

test('forged links, subscriptions, old annual terms and courtesy contracts fail closed', () => {
  const update = (fields) => ({ ...event, payload: { ...event.payload, resource: { ...payment, ...fields } } });
  assert.equal(run(update({paymentLink:'plink_other'})).decision, 'manual_review');
  assert.equal(run(update({paymentLink:null, subscription:'sub_98765'})).decision, 'manual_review');
  assert.equal(run(event,{...sale,billing_cycle_months:12}).decision,'manual_review');
  assert.equal(run(event,{...sale,provider:'stripe'}).decision,'manual_review');
  assert.equal(run(event,{...sale,environment:'production'}).decision,'manual_review');
  assert.equal(run(event,{...sale,sale_status:'lead'}).decision,'manual_review');
});

test('mismatched amount, payment method, link configuration or status cannot confirm', () => {
  const modified = (fields) => ({ ...event, payload: { ...event.payload, resource: { ...payment, ...fields } } });
  assert.equal(run(modified({value:0.79})).reason,'amount_mismatch');
  assert.equal(run(modified({value:159})).reason,'amount_mismatch');
  assert.equal(run(modified({billingType:'BOLETO'})).reason,'method_mismatch');
  assert.equal(run(event,sale,{...link,value:119}).reason,'amount_mismatch');
  assert.equal(run(event,sale,{...link,chargeType:'INSTALLMENT'}).reason,'asaas_link_configuration_mismatch');
  assert.equal(run(modified({status:'PENDING'})).reason,'status_mismatch');
  assert.equal(run({...event,event_type:'PAYMENT_RECEIVED',payload:{event:'PAYMENT_CONFIRMED',resource:payment}}).reason,'untrusted_envelope');
});

test('unpaid and reversal events never trigger payment approval', () => {
  for (const type of ['PAYMENT_CREATED','PAYMENT_OVERDUE','PAYMENT_REFUNDED','PAYMENT_DELETED','PAYMENT_CHARGEBACK_REQUESTED']) {
    const outcome=run({...event,event_type:type,payload:{...event.payload,event:type}});
    assert.equal(outcome.decision,'hold');
  }
});

test('renewal can be matched against trusted existing Asaas subscription identifier', () => {
  const renewal = { ...event, payload: { ...event.payload, resource: {...payment,paymentLink:null} } };
  assert.equal(run(renewal,{...sale,asaas_subscription_id:'sub_98765'}).decision,'candidate_for_manual_verified_reconciliation');
});
