import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../supabase/functions/nexus-public-crm-monthly-asaas/index.ts', import.meta.url), 'utf8');

test('Asaas checkout is off by default and SANDBOX ONLY', () => {
  assert.match(source, /NEXUS_CRM_ASAAS_MONTHLY_ENABLED/);
  assert.match(source, /NEXUS_CRM_ASAAS_MONTHLY_MODE/);
  assert.match(source, /!== 'sandbox'/);
  assert.match(source, /ASAAS_SANDBOX_API_KEY/);
  assert.match(source, /https:\/\/api-sandbox\.asaas\.com\/v3\/paymentLinks/);
  assert.doesNotMatch(source, /https:\/\/api\.asaas\.com\/v3\/paymentLinks/);
  assert.doesNotMatch(source, /'ASAAS_API_KEY'/);
});

test('seller plan controls subscription price and method, never input amount', () => {
  assert.match(source, /planIsMonthly\(plan, hiddenTest\)/);
  assert.match(source, /buildCrmAsaasRecurringLink\(\{ plan: publicPlan, method, saleId: sale\.id \}\)/);
  assert.match(source, /billing_cycle_months: 1/);
  assert.match(source, /checkout_amount_cents: Number\(plan\.price_cents\)/);
  assert.match(source, /paymentMethod/);
  assert.match(source, /method !== 'PIX' && method !== 'BOLETO'/);
});

test('the Central prevents charging an existing courtesy and requires signed request', () => {
  assert.match(source, /verifyCheckoutBridgeSignature\(/);
  assert.match(source, /consume_nexus_public_request_limit/);
  assert.match(source, /eq\('registration_number', input\.registrationNumber\)/);
  assert.match(source, /if \(existingOrg\?\.id\)/);
  assert.match(source, /checkout_created','paid','provisioned'/);
  assert.match(source, /provider: 'asaas', environment: 'sandbox'/);
  assert.match(source, /asaas_checkout_id: linkId/);
  assert.match(source, /safeAsaasUrl\(result\?\.url\)/);
  assert.ok(source.indexOf('if (existingOrg?.id)') < source.indexOf("fetch('https://api-sandbox.asaas.com"));
  assert.doesNotMatch(source, /provisionCrmTenant|syncCrmEntitlement|grantCourtesy/);
});
