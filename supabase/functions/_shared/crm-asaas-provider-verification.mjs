import { classifyCrmAsaasSettlement } from './crm-asaas-reconciliation.mjs';

// One-shot, read-only verification of a queued Asaas event against three/four
// independent provider records; no HTTP requests are issued by this module.
// fetchResource(relativePath) must be a server-side authenticated, bounded,
// sandbox-only Asaas GET. Customer details are never included in the output.
const safeId = (v, prefix) => typeof v === 'string' && new RegExp('^' + prefix + '_[A-Za-z0-9_-]{4,120}$').test(v);
const numericCents = v => typeof v === 'number' && Number.isFinite(v) && v > 0
  ? Math.round(v * 100) : null;
/** @param {string} reason @param {'manual_review'|'retry'|'hold'} [status] */
const reject = (reason, status = 'manual_review') => Object.freeze({ decision: status, reason });

export async function verifyCrmAsaasPayment({ eventRow, sale, fetchResource }) {
  if (!eventRow || eventRow.provider !== 'asaas' || !eventRow.event_type?.startsWith('PAYMENT_')) {
    return reject('not_asaas_payment','hold');
  }
  if (!['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(eventRow.event_type)) {
    return reject('not_settlement_event','hold');
  }
  if (!sale || sale.provider !== 'asaas' || sale.environment !== 'sandbox'
    || typeof sale.id !== 'string' || !/^[0-9a-f-]{36}$/.test(sale.id)
    || typeof sale.asaas_checkout_id !== 'string'
    || !/^[A-Za-z0-9_-]{4,120}$/.test(sale.asaas_checkout_id)) {
    return reject('sale_invalid');
  }
  if (typeof fetchResource !== 'function') return reject('provider_reader_missing');
  const paymentId = eventRow.payload?.resource?.id;
  if (!safeId(paymentId,'pay')) return reject('payment_id_invalid');
  if (!/^[A-Za-z0-9_-]{4,120}$/.test(sale.asaas_checkout_id)) return reject('link_id_invalid');
  let payment, link, customer, subscription;
  try {
    // Never read URLs supplied by the webhook: path components are allowlisted IDs.
    payment = await fetchResource('/payments/' + paymentId);
    link = await fetchResource('/paymentLinks/' + sale.asaas_checkout_id);
    const customerId = payment?.customer;
    if (!safeId(customerId,'cus')) return reject('customer_id_missing');
    customer = await fetchResource('/customers/' + customerId);
    const subId = payment?.subscription;
    if (subId !== null && subId !== undefined) {
      if (!safeId(subId,'sub')) return reject('subscription_id_invalid');
      subscription = await fetchResource('/subscriptions/' + subId);
    }
  } catch {
    return reject('provider_lookup_failed','retry');
  }
  if (payment?.id !== paymentId || link?.id !== sale.asaas_checkout_id) return reject('provider_record_mismatch');
  if (!subscription || subscription?.id !== payment.subscription) return reject('subscription_not_verified');
  if (subscription?.customer !== payment.customer || customer?.id !== payment.customer) {
    return reject('provider_customer_mismatch');
  }
  const saleDocument = String(sale.registration_number || '').replace(/\D/g, '');
  const paidDocument = String(customer?.cpfCnpj || '').replace(/\D/g, '');
  if (![11,14].includes(saleDocument.length) || paidDocument !== saleDocument) {
    return reject('customer_document_mismatch');
  }
  if (link.externalReference !== 'nexus-crm-monthly-' + sale.id) {
    return reject('link_reference_mismatch');
  }
  if (sale.asaas_subscription_id && sale.asaas_subscription_id !== subscription.id) {
    return reject('subscription_conflict');
  }
  if (link.billingType !== payment.billingType || link.billingType !== subscription.billingType
    || link.subscriptionCycle !== 'MONTHLY' || subscription.cycle !== 'MONTHLY'
    || link.chargeType !== 'RECURRENT') return reject('recurrence_config_mismatch');
  const cents = Number(sale.checkout_amount_cents);
  if (!Number.isSafeInteger(cents) || cents <= 0
    || numericCents(payment.value) !== cents
    || numericCents(link.value) !== cents
    || numericCents(subscription.value) !== cents) return reject('price_mismatch');

  // A current provider status beats an old webhook notification (e.g. refund).
  const augmentedEvent = {
    ...eventRow, payload: {
      ...eventRow.payload,
      resource: {
        ...eventRow.payload.resource,
        id: payment.id, paymentLink: payment.paymentLink || null,
        subscription: payment.subscription, status: payment.status,
        value: payment.value, billingType: payment.billingType,
      },
    },
  };
  const classification = classifyCrmAsaasSettlement(augmentedEvent, sale, link);
  if (classification.decision !== 'candidate_for_manual_verified_reconciliation') return classification;
  return Object.freeze({
    decision: 'verified_for_review',
    saleId: sale.id,
    eventId: eventRow.provider_event_id,
    paymentId: payment.id,
    subscriptionId: subscription.id,
    billingType: payment.billingType,
    amountCents: cents,
    // This is NEVER a grant. The atomic paid->provisioned transaction, provider
    // lifecycle and entitlement sync must be separately reviewed and tested.
    canActivateCrm: false,
  });
}
