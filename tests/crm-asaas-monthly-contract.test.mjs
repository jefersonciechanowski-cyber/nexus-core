import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCrmAsaasRecurringLink } from '../supabase/functions/_shared/crm-asaas-monthly-contract.mjs';

const plan = {
  code: 'start', name: 'Nexus CRM Start', status: 'active',
  public_visible: true, price_cents: 7900, currency: 'BRL', billing_interval_months: 1,
};
const saleId = 'fa22f49b-190f-4d9c-bc47-cc1c51643f64';

test('Pix Asaas is monthly recurring invoicing, NOT 10/12 month prepaid or automatic debit', () => {
  const body = buildCrmAsaasRecurringLink({ plan, method: 'PIX', saleId });
  assert.equal(body.value, 79);
  assert.equal(body.billingType, 'PIX');
  assert.equal(body.chargeType, 'RECURRENT');
  assert.equal(body.subscriptionCycle, 'MONTHLY');
  assert.equal(body.externalReference, 'nexus-crm-monthly-' + saleId);
  assert.equal(Object.hasOwn(body, 'installmentCount'), false);
  assert.equal(Object.hasOwn(body, 'paymentCreationMode'), false);
});

test('Boleto Asaas generates a separate monthly invoice with payment due-date window', () => {
  const body = buildCrmAsaasRecurringLink({ plan: { ...plan, code: 'pro', name: 'Nexus CRM Pro', price_cents: 11900 }, method: 'BOLETO', saleId });
  assert.equal(body.value, 119);
  assert.equal(body.subscriptionCycle, 'MONTHLY');
  assert.equal(body.billingType, 'BOLETO');
  assert.equal(body.dueDateLimitDays, 7);
  assert.equal(body.notificationEnabled, true);
});

test('hidden, annual, free, fabricated and client-overridden plans cannot be invoiced', () => {
  const params = { plan, method: 'PIX', saleId };
  for (const corrupted of [
    { ...plan, billing_interval_months: 12 }, { ...plan, public_visible: false },
    { ...plan, code: 'custom' }, { ...plan, price_cents: 0 },
    { ...plan, price_cents: -1000 }, { ...plan, price_cents: 7999.99 },
    { ...plan, currency: 'USD' }, { ...plan, status: 'inactive' },
  ]) {
    assert.throws(() => buildCrmAsaasRecurringLink({ ...params, plan: corrupted }));
  }
  for (const method of ['CREDIT_CARD', 'UNDEFINED', 'INSTALLMENT', 'pix', '']) {
    assert.throws(() => buildCrmAsaasRecurringLink({ ...params, method }));
  }
  assert.throws(() => buildCrmAsaasRecurringLink({ ...params, saleId: 'invalid' }));
});
