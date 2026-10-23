import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCheckout, planIsMonthly, checkoutFeatureMode, CRM_PUBLIC_PLANS } from '../supabase/functions/nexus-public-crm-monthly-checkout/contract.mjs';

const sample = Object.freeze({
  companyName: 'Empresa Teste CRM', responsibleName: 'Responsável',
  email: 'teste@empresa.example', phone: '(46) 99999-1111',
  registrationNumber: '123.456.789-09', postalCode: '85620-000',
  street: 'Rua Um', streetNumber: '10', district: 'Centro', city: 'Realeza',
  state: 'PR', planCode: 'start', acceptedTerms: true,
});

test('only Start, Pro and Gestão monthly plans can be purchased', () => {
  assert.deepEqual(CRM_PUBLIC_PLANS, ['start', 'pro', 'gestao']);
  for (const code of CRM_PUBLIC_PLANS) {
    assert.equal(planIsMonthly({ code, status: 'active', billing_interval_months: 1, price_cents: 7900, public_visible: true }), true);
  }
  assert.equal(planIsMonthly({ code: 'custom', status: 'active', billing_interval_months: 1, price_cents: 7900, public_visible: true }), false);
  assert.equal(planIsMonthly({ code: 'start', status: 'active', billing_interval_months: 12, price_cents: 7900, public_visible: true }), false);
  assert.equal(planIsMonthly({ code: 'start', status: 'active', billing_interval_months: 1, price_cents: 0, public_visible: true }), false);
  assert.equal(planIsMonthly({ code: 'start', status: 'active', billing_interval_months: 1, price_cents: 7900, public_visible: false }), false);
  assert.equal(planIsMonthly({ code: 'start', status: 'active', billing_interval_months: 1, price_cents: 7900, public_visible: false }, true), true);
});

test('normalize validated customer details, never accepts caller price or provider status', () => {
  const normalized = normalizeCheckout({ ...sample, price_cents: 1, environment: 'production', entitlement: 'active' });
  assert.ok(normalized.payload);
  assert.equal(normalized.payload.registrationNumber, '12345678909');
  assert.equal(normalized.payload.email, 'teste@empresa.example');
  assert.equal(normalized.payload.planCode, 'start');
  for (const key of ['price_cents','environment','entitlement','provider','billing_interval_months']) {
    assert.equal(Object.hasOwn(normalized.payload, key), false);
  }
  assert.ok(normalizeCheckout({ ...sample, acceptedTerms: false }).error);
  assert.ok(normalizeCheckout({ ...sample, planCode: 'custom' }).error);
  assert.ok(normalizeCheckout({ ...sample, registrationNumber: 'wrong' }).error);
});

test('default off; test/live keys cannot be confused; live needs 3 gates', () => {
  assert.equal(checkoutFeatureMode({}), null);
  assert.equal(checkoutFeatureMode({ NEXUS_CRM_MONTHLY_CHECKOUT_ENABLED: 'true', NEXUS_CRM_MONTHLY_CHECKOUT_MODE: 'sandbox', STRIPE_SECRET_KEY: 'sk_live_abc' }), null);
  assert.equal(checkoutFeatureMode({ NEXUS_CRM_MONTHLY_CHECKOUT_ENABLED: 'true', NEXUS_CRM_MONTHLY_CHECKOUT_MODE: 'sandbox', STRIPE_TEST_SECRET_KEY: 'sk_test_demo' }), 'sandbox');
  assert.equal(checkoutFeatureMode({ NEXUS_CRM_MONTHLY_CHECKOUT_ENABLED: 'true', NEXUS_CRM_MONTHLY_CHECKOUT_MODE: 'production', STRIPE_SECRET_KEY: 'sk_live_demo' }), null);
  assert.equal(checkoutFeatureMode({ NEXUS_CRM_MONTHLY_CHECKOUT_ENABLED: 'true', NEXUS_CRM_MONTHLY_CHECKOUT_MODE: 'production', STRIPE_SECRET_KEY: 'sk_live_demo', NEXUS_CRM_LIVE_CHECKOUT_ENABLED: 'true', NEXUS_PAYMENT_LIVE_ENABLED: 'true' }), 'production');
});

test('backend only trusts signed proxy and reads monthly price from Central', () => {
  const source = readFileSync(new URL('../supabase/functions/nexus-public-crm-monthly-checkout/index.ts', import.meta.url), 'utf8');
  assert.match(source, /verifyProxySignature\(raw, request, bridgeKey\)/);
  assert.match(source, /crypto\.subtle\.verify\('HMAC'/);
  assert.match(source, /consume_nexus_public_request_limit/);
  assert.match(source, /p_limit: 3/);
  assert.match(source, /plan\.price_cents/);
  assert.match(source, /payment_method_configuration: methodConfig/);
  assert.match(source, /NEXUS_CRM_CARD_PAYMENT_CONFIG_LIVE/);
  assert.match(source, /NEXUS_CRM_CARD_PAYMENT_CONFIG_TEST/);
  assert.doesNotMatch(source, /(?:^|[{,]\\s*)payment_method_types\\s*:/m);
  assert.match(source, /mode: 'subscription'/);
  assert.match(source, /interval_count: 1/);
  assert.match(source, /nexus_sale_id: sale\.id/);
  assert.match(source, /idempotencyKey: 'crm-monthly-' \+ sale\.id/);
  assert.match(source, /return_origin: CRM_PUBLIC_ORIGIN/);
  assert.doesNotMatch(source, /createUser|grantCourtesy|grantTrial|courtesyMonths/);
});
