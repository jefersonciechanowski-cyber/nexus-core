// Pure classification: never modifies accounts, settlements or subscriptions.
// trustedLinkConfig must come from an authenticated Asaas API read, not from the webhook.
export function classifyCrmAsaasSettlement(eventRow, sale, trustedLinkConfig) {
  const skip = (reason) => Object.freeze({ decision: 'hold', reason });
  const review = (reason) => Object.freeze({ decision: 'manual_review', reason });
  if (!eventRow || eventRow.provider !== 'asaas'
    || !eventRow.payload || !eventRow.payload.resource
    || eventRow.event_type !== eventRow.payload.event) return skip('untrusted_envelope');
  const payment = eventRow.payload.resource;
  if (!eventRow.event_type.startsWith('PAYMENT_')) return skip('not_payment');
  if (!['PAYMENT_CONFIRMED','PAYMENT_RECEIVED'].includes(eventRow.event_type)) {
    return skip('payment_not_settled');
  }
  if (!sale || sale.provider !== 'asaas' || sale.environment !== 'sandbox'
    || !['checkout_created','paid','provisioned'].includes(sale.sale_status)
    || sale.billing_mode !== 'recurring' || sale.billing_cycle_months !== 1) {
    return review('sale_not_safe_to_settle');
  }
  if (!trustedLinkConfig || trustedLinkConfig.id !== sale.asaas_checkout_id
    || trustedLinkConfig.chargeType !== 'RECURRENT'
    || trustedLinkConfig.subscriptionCycle !== 'MONTHLY'
    || !['BOLETO','PIX'].includes(trustedLinkConfig.billingType)) {
    return review('asaas_link_configuration_mismatch');
  }
  const isOriginPayment = payment.paymentLink && payment.paymentLink === sale.asaas_checkout_id;
  const isRecurringPayment = !!(sale.asaas_subscription_id
    && payment.subscription === sale.asaas_subscription_id);
  if (!isOriginPayment && !isRecurringPayment) return review('payment_does_not_match_link_or_subscription');
  if (payment.billingType !== trustedLinkConfig.billingType) return review('method_mismatch');
  const expectedCents = Number(sale.checkout_amount_cents);
  const linkCents = Number.isFinite(trustedLinkConfig.value)
    ? Math.round(trustedLinkConfig.value * 100) : NaN;
  const paymentCents = Number.isFinite(payment.value)
    ? Math.round(payment.value * 100) : NaN;
  if (!Number.isSafeInteger(expectedCents) || expectedCents <= 0
    || linkCents !== expectedCents || paymentCents !== expectedCents) {
    return review('amount_mismatch');
  }
  if (!['CONFIRMED','RECEIVED'].includes(payment.status)
    || (eventRow.event_type === 'PAYMENT_RECEIVED' && payment.status !== 'RECEIVED')) {
    return review('status_mismatch');
  }
  if (typeof payment.id !== 'string' || !/^pay_[A-Za-z0-9_-]{5,120}$/.test(payment.id)) {
    return review('payment_identifier_invalid');
  }
  return Object.freeze({
    decision: 'candidate_for_manual_verified_reconciliation',
    saleId: sale.id,
    paymentId: payment.id,
    amountCents: expectedCents,
  });
}
