// Contract only. This module performs no network calls, creates no charges,
// grants no access, and leaves all existing Asaas 410 endpoints untouched.
// Implementation of the signed webhook is required before enabling Pix/boleto.
const allowedPlans = new Set(['start','pro','gestao']);
const allowedMethods = new Set(['PIX','BOLETO']);

export function buildCrmAsaasRecurringLink({ plan, method, saleId }) {
  if (!plan || !allowedPlans.has(plan.code) || plan.status !== 'active'
    || plan.billing_interval_months !== 1 || plan.currency !== 'BRL'
    || plan.public_visible !== true || !Number.isSafeInteger(plan.price_cents)
    || plan.price_cents <= 0) throw new Error('Plano CRM mensal indisponível.');
  if (typeof method !== 'string' || !allowedMethods.has(method)) {
    throw new Error('Forma de pagamento não permitida.');
  }
  if (typeof saleId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(saleId)) {
    throw new Error('Identificador de venda inválido.');
  }

  // Asaas recurring payment links generate monthly invoices for boleto and Pix.
  // PIX here is *not* an automatic debit authorization (Pix Automático).
  // No annual upfront amount or installment agreement is generated.
  const body = {
    name: `Assinatura mensal Nexus CRM ${plan.name || plan.code}`.slice(0, 120),
    description: 'Mensalidade Nexus CRM sem fidelidade anual.',
    value: plan.price_cents / 100,
    billingType: method,
    chargeType: 'RECURRENT',
    subscriptionCycle: 'MONTHLY',
    externalReference: `nexus-crm-monthly-${saleId}`,
    notificationEnabled: true,
    isAddressRequired: true,
    ...(method === 'BOLETO' ? { dueDateLimitDays: 7 } : {}),
  };
  return Object.freeze(body);
}
