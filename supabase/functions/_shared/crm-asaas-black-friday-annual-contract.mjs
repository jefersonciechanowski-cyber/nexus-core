// Pure configuration for a future Black Friday annual Asaas checkout.
// No API calls, charge creation, tenant access, or silent renewal occur here.
// The Asaas annual campaign requires a SEPARATE verified, prepaid settlement
// worker; the existing monthly recurring worker must NEVER process this sale.
const PLANS = new Set(['start','pro','gestao']);
const METHODS = new Set(['PIX','BOLETO','CREDIT_CARD']);
const uuid = value => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);

export const CRM_BF_ANNUAL_MONTHS = 12;
export const CRM_BF_ANNUAL_PAID_MONTHS = 10;

export function quoteCrmBlackFridayAnnual(plan) {
  if (!plan || !PLANS.has(plan.code) || plan.status !== 'active'
    || plan.public_visible !== true || plan.currency !== 'BRL'
    || plan.billing_interval_months !== 1
    || !Number.isSafeInteger(plan.price_cents)
    || plan.price_cents <= 0 || plan.price_cents > 10000000)
    throw new Error('Plano mensal Nexus CRM inválido para oferta anual.');
  const monthlyCents = plan.price_cents;
  return Object.freeze({
    planCode: plan.code, monthlyCents,
    regularAnnualCents: monthlyCents * CRM_BF_ANNUAL_MONTHS,
    annualAmountCents: monthlyCents * CRM_BF_ANNUAL_PAID_MONTHS,
    savingsCents: monthlyCents * (CRM_BF_ANNUAL_MONTHS - CRM_BF_ANNUAL_PAID_MONTHS),
    billingMode: 'prepaid', billingCycleMonths: CRM_BF_ANNUAL_MONTHS,
    autoRenew: false,
  });
}

export function buildCrmAsaasBlackFridayAnnualLink({ plan, method, saleId }) {
  const quote = quoteCrmBlackFridayAnnual(plan);
  if (!METHODS.has(method)) throw new Error('Método anual indisponível.');
  if (!uuid(saleId)) throw new Error('ID de venda inválido.');
  return Object.freeze({
    name: ('Nexus CRM ' + (plan.name || plan.code) + ' - Black Friday 12 meses por 10').slice(0,120),
    description: 'Pagamento único antecipado. Acesso por 12 meses, sem renovação automática.',
    value: quote.annualAmountCents / 100,
    billingType: method,
    chargeType: method === 'CREDIT_CARD' ? 'INSTALLMENT' : 'DETACHED',
    ...(method === 'CREDIT_CARD' ? { maxInstallmentCount: 10 } : {}),
    externalReference: 'nexus-crm-bf-annual-' + saleId,
    notificationEnabled: true,
    isAddressRequired: true,
    limit: 1,
    ...(method === 'BOLETO' ? { dueDateLimitDays: 7 } : {}),
  });
}
