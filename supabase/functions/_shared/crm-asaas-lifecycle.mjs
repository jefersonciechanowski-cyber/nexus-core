// CRM Asaas lifecycle decision engine: PURE and default-deny.
// Never updates a database or remotely suspends a tenant.
// Use only after independently verifying current Asaas payment/subscription
// and matching stored Central sale/access. Events can arrive out of order.
const forbidden = reason => Object.freeze({ decision: 'manual_review', reason });
const held = reason => Object.freeze({ decision: 'hold', reason });
function eventTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : null;
}
function sameMoney(cents, amount) {
  return Number.isSafeInteger(cents) && cents > 0 && typeof amount === 'number'
    && Number.isFinite(amount) && Math.round(amount * 100) === cents;
}

/**
 * @returns {{decision:string,reason?:string,action?:string,subscriptionStatus?:string,accessStatus?:string,eventId?:string}}
 */
export function decideCrmAsaasLifecycle({ event, sale, access, payment, subscription, now, verifiedDeletion = false }) {
  if (!event || event.provider !== 'asaas' || !event.provider_event_id?.startsWith('asaas:evt_')
    || event.payload?.event !== event.event_type) return forbidden('unauthenticated_or_malformed_event');
  const occurred = eventTime(event.occurredAt);
  const checked = eventTime(now);
  if (occurred === null || checked === null || occurred > checked + 5 * 60_000) return forbidden('bad_event_time');
  const last = access?.provider_state_event_created_at ? eventTime(access.provider_state_event_created_at) : null;
  if (last !== null && occurred <= last) return held('stale_or_duplicate');
  if (event.provider_event_id === access?.provider_state_event_id) return held('duplicate');

  if (!sale || sale.provider !== 'asaas' || sale.environment !== 'sandbox'
    || sale.billing_mode !== 'recurring' || sale.billing_cycle_months !== 1
    || !access || access.billing_provider !== 'asaas' || access.billing_mode !== 'recurring'
    || access.commercial_condition !== 'standard' || access.product_code !== 'crm'
    || sale.organization_id !== access.organization_id
    || !sale.asaas_subscription_id || sale.asaas_subscription_id !== access.provider_subscription_id) {
    return forbidden('contract_not_eligible_or_courtesy');
  }
  const type = event.event_type;
  const isSubscriptionEvent = type.startsWith('SUBSCRIPTION_');
  const resource = event.payload?.resource;
  if (!resource || typeof resource.id !== 'string') return forbidden('event_resource_missing');
  if (isSubscriptionEvent && resource.id !== sale.asaas_subscription_id) return forbidden('wrong_subscription');

  if (type === 'PAYMENT_OVERDUE') return held('await_explicit_grace_policy');
  if (type.startsWith('PAYMENT_CHARGEBACK')) return forbidden('chargeback_requires_manual_review');
  if (type === 'SUBSCRIPTION_DELETED') {
    if (access.subscription_status === 'cancelled') return held('already_cancelled');
    if (!verifiedDeletion || (subscription && subscription.id !== sale.asaas_subscription_id)) {
      return forbidden('deletion_not_independently_verified');
    }
    return Object.freeze({ decision:'candidate',action:'cancel',
      subscriptionStatus:'cancelled',accessStatus:'suspended',eventId:event.provider_event_id });
  }
  if (type === 'SUBSCRIPTION_INACTIVATED') {
    if (access.subscription_status === 'cancelled') return held('terminal_cancelled');
    if (subscription?.id !== sale.asaas_subscription_id || subscription.status !== 'INACTIVE') {
      return forbidden('inactive_not_independently_verified');
    }
    return Object.freeze({ decision:'candidate',action:'suspend',
      subscriptionStatus:'past_due',accessStatus:'suspended',eventId:event.provider_event_id });
  }
  if (!['PAYMENT_REFUNDED','PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(type)) return held('unsupported_transition');
  if (access.subscription_status === 'cancelled') return held('terminal_cancelled');
  if (!payment || payment.id !== resource.id || payment.subscription !== sale.asaas_subscription_id
    || payment.id !== event.relatedPaymentId || payment.id !== access.knownProviderPaymentId) {
    return forbidden('unlinked_provider_payment');
  }
  if (!sameMoney(Number(access.contracted_price_cents), payment.value)
    || subscription?.id !== sale.asaas_subscription_id) return forbidden('amount_or_subscription_mismatch');
  if (type === 'PAYMENT_REFUNDED') {
    if (payment.status !== 'REFUNDED') return forbidden('refund_not_independently_verified');
    return Object.freeze({ decision:'candidate',action:'suspend',
      subscriptionStatus:'past_due',accessStatus:'suspended',eventId:event.provider_event_id });
  }
  if (!['RECEIVED','CONFIRMED'].includes(payment.status) || subscription.status !== 'ACTIVE') {
    return forbidden('paid_state_not_independently_verified');
  }
  return Object.freeze({ decision:'candidate',action:'reactivate',
    subscriptionStatus:'active',accessStatus:'active',eventId:event.provider_event_id });
}
