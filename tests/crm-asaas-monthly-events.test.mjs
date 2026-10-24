import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trustedAsaasToken, sanitizeCrmAsaasEvent } from '../supabase/functions/_shared/crm-asaas-events.mjs';
const validToken = 'webhook-as-a-service-test-token-0123456789';
const event = {
  id: 'evt_05b708f961d739ea7eba7e4db318f621',
  event: 'PAYMENT_RECEIVED',
  dateCreated: '2026-10-24 10:00:00',
  account: { email: 'should-not-be-saved@example.invalid' },
  payment: {
    id: 'pay_080225913252', paymentLink: '7a24809f2f', subscription: 'sub_m5gdy1upm25fbwgx',
    status: 'RECEIVED', billingType: 'PIX', value: 79,
    customer: 'cus_123456789', customerEmail: 'sensitive@example.invalid',
  },
};

test('Asaas webhook requires its own 32+ character token', () => {
  assert.equal(trustedAsaasToken(validToken, validToken), true);
  assert.equal(trustedAsaasToken(validToken, validToken + 'wrong'), false);
  assert.equal(trustedAsaasToken('', validToken), false);
  assert.equal(trustedAsaasToken(validToken, 'short'), false);
  assert.equal(trustedAsaasToken(null, validToken), false);
});

test('normalization preserves payment link/subscription ID but drops customer data', () => {
  const safe = sanitizeCrmAsaasEvent(event);
  assert.equal(safe.provider_event_id, 'asaas:' + event.id);
  assert.equal(safe.provider, 'asaas');
  assert.equal(safe.event_type, 'PAYMENT_RECEIVED');
  assert.equal(safe.resource_id, event.payment.id);
  assert.equal(safe.payload.resource.paymentLink, event.payment.paymentLink);
  assert.equal(safe.payload.resource.subscription, event.payment.subscription);
  assert.equal(safe.payload.resource.value, 79);
  assert.doesNotMatch(JSON.stringify(safe), /sensitive@example|should-not-be-saved|cus_123/);
});

test('Asaas financial event variants and documented composite event ids are stored safely', () => {
  const composite = {
    ...event, id: 'evt_6561b631fa5580caadd00bbe3b858607&9193', event: 'PAYMENT_PARTIALLY_REFUNDED',
  };
  const safe = sanitizeCrmAsaasEvent(composite);
  assert.equal(safe.provider_event_id, 'asaas:' + composite.id);
  assert.equal(safe.event_type, 'PAYMENT_PARTIALLY_REFUNDED');
});

test('unknown events and malformed provider IDs do not enter payment inbox', () => {
  for (const altered of [
    { ...event, id: 'no-id' },
    { ...event, event: 'TRANSFER_RECEIVED' },
    { ...event, event: 'PAYMENT_RECEIVED', payment: null },
    { ...event, payment: { id: 'fake', status: 'RECEIVED' } },
  ]) {
    assert.equal(sanitizeCrmAsaasEvent(altered), null);
  }
});

test('webhook only stores events idempotently; it cannot release CRM or alter payment status', () => {
  const source = readFileSync(new URL('../supabase/functions/nexus-crm-asaas-monthly-events/index.ts', import.meta.url), 'utf8');
  assert.match(source, /asaas-access-token/);
  assert.match(source, /NEXUS_CRM_ASAAS_EVENTS_TEST_TOKEN/);
  assert.match(source, /NEXUS_CRM_ASAAS_MONTHLY_MODE/);
  assert.match(source, /nexus_payment_webhook_events/);
  assert.match(source, /error\.code !== '23505'/);
  assert.match(source, /duplicate: error\?\.code === '23505'/);
  for (const unsafe of ['provisionCrmTenant', 'syncCrmEntitlement', 'update({ sale_status:', 'setTimeout(', 'ASAAS_API_KEY']) {
    assert.equal(source.includes(unsafe), false, unsafe);
  }
});
