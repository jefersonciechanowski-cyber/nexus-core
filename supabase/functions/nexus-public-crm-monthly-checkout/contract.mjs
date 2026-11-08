// Pure, testable validations for the public monthly Nexus CRM subscription checkout.
// The source of prices, entitlement and monthly interval remains the Central database.
export const CRM_PUBLIC_PLANS = Object.freeze(['start', 'pro', 'gestao']);
export const CRM_PUBLIC_ORIGIN = 'https://crm.nexuscore.app.br';
// Separate published CRM sales site on the Nexus Core main domain.
// Do NOT replace CRM_PUBLIC_ORIGIN: Stripe and authenticated CRM keep
// their existing origin and gate. This constant is Asaas-specific.
export const CRM_ASAAS_PUBLIC_ORIGIN = 'https://nexuscore.app.br';
// Preview must be explicitly configured and may talk only to sandbox.
export function checkoutOriginIsAllowed(origin, mode, previewOrigin) {
  if (origin === CRM_PUBLIC_ORIGIN) return true;
  if (mode !== 'sandbox' || typeof previewOrigin !== 'string' || origin !== previewOrigin) return false;
  try {
    const url = new URL(previewOrigin);
    return url.protocol === 'https:' && url.origin === previewOrigin
      && url.pathname === '/' && !url.search && !url.hash
      && !url.username && !url.password && !url.port
      && /^nexus-crm-preview-[a-z0-9-]+-nexuscoreindustria-2420s-projects[.]vercel[.]app$/.test(url.hostname);
  } catch { return false; }
}

export function clean(value, max = 160) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}
export function digits(value) {
  return clean(value, 40).replace(/\D/g, '');
}
// Billing preflight must reject invalid digits BEFORE creating a payment
// link, even in Sandbox. No provider lookup or personal data is needed.
function numericCheckDigit(value, weights) {
  const sum = weights.reduce((total, weight, index) => total + Number(value[index]) * weight, 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function validNationalDocument(value) {
  if (typeof value !== 'string' || !/^(?:\d{11}|\d{14})$/.test(value)
    || /^(\d)\1+$/.test(value)) return false;
  if (value.length === 11) {
    return Number(value[9]) === numericCheckDigit(value, [10,9,8,7,6,5,4,3,2])
      && Number(value[10]) === numericCheckDigit(value, [11,10,9,8,7,6,5,4,3,2]);
  }
  return Number(value[12]) === numericCheckDigit(value, [5,4,3,2,9,8,7,6,5,4,3,2])
    && Number(value[13]) === numericCheckDigit(value, [6,5,4,3,2,9,8,7,6,5,4,3,2]);
}

export function normalizeCheckout(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { error: 'Dados inválidos.' };
  const document = digits(input.registrationNumber);
  const email = clean(input.email, 180).toLowerCase();
  const planCode = clean(input.planCode, 30).toLowerCase();
  // Free trials are a separately claimed product; never silently turn them into a paid checkout.
  if (input.trialDays !== undefined && input.trialDays !== 0 && input.trialDays !== '0') {
    return { error: 'O teste gratuito deve ser ativado por um fluxo específico, sem cobrança.' };
  }
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
    || payload.phone.length < 10 || !validNationalDocument(document)
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
