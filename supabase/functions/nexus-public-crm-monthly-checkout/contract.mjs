// Pure, testable validations for the public monthly Nexus CRM subscription checkout.
// The source of prices, entitlement and monthly interval remains the Central database.
export const CRM_PUBLIC_PLANS = Object.freeze(['start', 'pro', 'gestao']);
export const CRM_PUBLIC_ORIGIN = 'https://crm.nexuscore.app.br';

export function clean(value, max = 160) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}
export function digits(value) {
  return clean(value, 40).replace(/\D/g, '');
}
export function normalizeCheckout(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Dados inválidos.' };
  const document = digits(input.registrationNumber);
  const email = clean(input.email, 180).toLowerCase();
  const planCode = clean(input.planCode, 30).toLowerCase();
  const acceptedTerms = input.acceptedTerms === true;
  const payload = {
    companyName: clean(input.companyName, 160),
    responsibleName: clean(input.responsibleName, 120),
    email,
    phone: digits(input.phone).slice(0, 15),
    registrationNumber: document,
    registrationType: document.length === 14 ? 'CNPJ' : 'CPF',
    postalCode: digits(input.postalCode).slice(0, 8),
    street: clean(input.street, 160),
    streetNumber: clean(input.streetNumber, 25),
    addressComplement: clean(input.addressComplement, 100),
    district: clean(input.district, 120),
    city: clean(input.city, 120),
    state: clean(input.state, 2).toUpperCase(),
    planCode,
    acceptedTerms,
    utmSource: clean(input.utmSource, 100),
    utmMedium: clean(input.utmMedium, 100),
    utmCampaign: clean(input.utmCampaign, 140),
    utmContent: clean(input.utmContent, 100),
    utmTerm: clean(input.utmTerm, 100),
    referrer: clean(input.referrer, 300),
  };
  const invalid = payload.companyName.length < 2 || payload.responsibleName.length < 2
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || payload.phone.length < 10 || ![11,14].includes(document.length)
    || payload.postalCode.length !== 8 || payload.street.length < 2
    || payload.streetNumber.length < 1 || payload.district.length < 2
    || payload.city.length < 2 || !/^[A-Z]{2}$/.test(payload.state)
    || !CRM_PUBLIC_PLANS.includes(planCode) || !acceptedTerms;
  if (invalid) return { error: 'Confira os dados e aceite os termos da contratação mensal.' };
  return { payload };
}
export function planIsMonthly(plan, allowHiddenInSandbox = false) {
  return !!plan && plan.status === 'active'
    && plan.billing_interval_months === 1
    && Number.isSafeInteger(Number(plan.price_cents))
    && Number(plan.price_cents) > 0
    && (plan.public_visible === true || allowHiddenInSandbox === true)
    && CRM_PUBLIC_PLANS.includes(plan.code);
}
export function checkoutFeatureMode(env) {
  // No live charges are possible with any one switch alone.
  if (env.NEXUS_CRM_MONTHLY_CHECKOUT_ENABLED !== 'true') return null;
  if (env.NEXUS_CRM_MONTHLY_CHECKOUT_MODE === 'sandbox') {
    return env.STRIPE_TEST_SECRET_KEY?.startsWith('sk_test_') ? 'sandbox' : null;
  }
  if (env.NEXUS_CRM_MONTHLY_CHECKOUT_MODE === 'production'
    && env.NEXUS_CRM_LIVE_CHECKOUT_ENABLED === 'true'
    && env.NEXUS_PAYMENT_LIVE_ENABLED === 'true') {
    return env.STRIPE_SECRET_KEY?.startsWith('sk_live_') ? 'production' : null;
  }
  return null;
}
