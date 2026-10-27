import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeCheckout, planIsMonthly, checkoutFeatureMode, checkoutOriginIsAllowed, CRM_PUBLIC_PLANS } from '../supabase/functions/nexus-public-crm-monthly-checkout/contract.mjs';

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
  assert.match(source, /verifyCheckoutBridgeSignature\(/);
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
  assert.match(source, /from\('organizations'\)/);
  assert.match(source, /eq\('registration_number', input\.registrationNumber\)/);
  assert.match(source, /if \(existingCompany\?\.id\)/);
  assert.match(source, /vinculação do plano à Central antes de pagar/);
  assert.ok(source.indexOf("if (existingCompany?.id)") < source.indexOf("stripe.checkout.sessions.create("));
  assert.doesNotMatch(source, /createUser|grantCourtesy|grantTrial|courtesyMonths/);
});

test('preview origin can only be an explicit official Preview and only for sandbox', () => {
  const preview='https://nexus-crm-preview-git-e974cb-nexuscoreindustria-2420s-projects.vercel.app';
  assert.equal(checkoutOriginIsAllowed(preview, 'sandbox', preview), true);
  assert.equal(checkoutOriginIsAllowed(preview, 'production', preview), false);
  assert.equal(checkoutOriginIsAllowed('https://crm.nexuscore.app.br', 'production', ''), true);
  assert.equal(checkoutOriginIsAllowed('https://evil.vercel.app', 'sandbox', 'https://evil.vercel.app'), false);
  assert.equal(checkoutOriginIsAllowed(preview, 'sandbox', preview + '.evil.com'), false);
  assert.equal(checkoutOriginIsAllowed(preview + '/', 'sandbox', preview), false);
  assert.equal(checkoutOriginIsAllowed(preview, 'sandbox', ''), false);
});

test('trial preference is denied by the paid checkout until trial entitlement is implemented', () => {
  assert.equal(normalizeCheckout({ ...sample, trialDays: 0 }).payload?.planCode, 'start');
  for (const trialDays of [15,30,'15','30','untrusted']) {
    assert.ok(normalizeCheckout({ ...sample, trialDays }).error);
  }
  const source = readFileSync(new URL('../supabase/functions/nexus-public-crm-monthly-checkout/index.ts', import.meta.url), 'utf8');
  assert.match(source, /NEXUS_CRM_CHECKOUT_BRIDGE_SECRET_TEST/);
  assert.match(source, /NEXUS_CRM_CHECKOUT_PREVIEW_ORIGIN/);
  assert.match(source, /checkoutOriginIsAllowed\(checkoutOrigin, mode,/);
  assert.match(source, /STAGED_CHECKOUT_DISABLED = true/);
});
