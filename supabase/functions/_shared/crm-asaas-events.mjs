// Pure event envelope normalization. Provider events are untrusted until the
// request token is verified. No payment or entitlement changes occur here.
export const CRM_ASAAS_FINANCIAL_EVENTS = new Set([
  'PAYMENT_CREATED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED',
  'PAYMENT_OVERDUE', 'PAYMENT_REFUNDED', 'PAYMENT_DELETED',
  'PAYMENT_CHARGEBACK_REQUESTED', 'PAYMENT_CHARGEBACK_DISPUTE',
  'SUBSCRIPTION_CREATED', 'SUBSCRIPTION_UPDATED', 'SUBSCRIPTION_DELETED',
]);

export function trustedAsaasToken(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string'
    || expected.length < 32 || actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

export function sanitizeCrmAsaasEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  const id = event.id, type = event.event;
  if (typeof id !== 'string' || !/^evt_[A-Za-z0-9_&.-]{6,150}$/.test(id)) return null;
  // The provider can add PAYMENT_/SUBSCRIPTION_ variants over time. Since this
  // inbox only persists and never provisions, retain valid future variants
  // rather than returning 422 and blocking Asaas delivery retries.
  if (typeof type !== 'string' || !/^(PAYMENT|SUBSCRIPTION)_[A-Z0-9_]{2,90}$/.test(type)) return null;
  const isPayment = type.startsWith('PAYMENT_');
  const data = isPayment ? event.payment : event.subscription;
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || typeof data.id !== 'string' || !/^(pay|sub)_[A-Za-z0-9_-]{5,120}$/.test(data.id)) return null;
  // Store only the identifiers and financial fields necessary for controlled
  // reconciliation; do not persist the payer's complete contact payload.
  const safe = {
    id, event: type, dateCreated: typeof event.dateCreated === 'string' ? event.dateCreated.slice(0, 50) : null,
    resource: {
      id: data.id,
      paymentLink: typeof data.paymentLink === 'string' ? data.paymentLink.slice(0, 150) : null,
      subscription: typeof data.subscription === 'string' ? data.subscription.slice(0, 150) : null,
      externalReference: typeof data.externalReference === 'string' ? data.externalReference.slice(0, 200) : null,
      status: typeof data.status === 'string' ? data.status.slice(0, 50) : null,
      billingType: typeof data.billingType === 'string' ? data.billingType.slice(0, 35) : null,
      value: Number.isFinite(data.value) && data.value >= 0 ? data.value : null,
    },
  };
  return {
    provider_event_id: 'asaas:' + id,
    provider: 'asaas', event_type: type,
    resource_id: data.id,
    payload: safe,
  };
}
