// Separate acceptance test, NOT a recurring product checkout. No external IO.
// Amount, billing type, production host, merchant account, and pilot identity
// are never caller-selected.
import { validNationalDocument } from '../nexus-public-crm-monthly-checkout/contract.mjs';

export const LIVE_PIX_AMOUNT_CENTS = 1000;
export const LIVE_PIX_AMOUNT_BRL = 10;
export const LIVE_PIX_SLOT = 1;
export const LIVE_PIX_PROVIDER_HOST = 'https://api.asaas.com/v3';
export const LIVE_PIX_CHARGE_CONFIRMATION = 'AUTORIZO COBRANCA REAL PIX DE R$ 10';
export const LIVE_PIX_PILOT_PREFIX = 'nexus-crm-live-pix-r10-';

const clean = (v, max) => typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
const digits = v => typeof v === 'string' ? v.replace(/\D/g, '') : '';

export function validateLivePixApplicant(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const companyName = clean(input.companyName, 160);
  const responsibleName = clean(input.responsibleName, 160);
  const email = clean(input.email, 254).toLowerCase();
  const cpf = digits(input.cpf);
  if (companyName.length < 2 || responsibleName.length < 2
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || !validNationalDocument(cpf) || cpf.length !== 11
    || input.acceptedOneTimeTerms !== true) return null;
  return { companyName, responsibleName, email, cpf };
}

export function canRunLivePixPilot(env, action) {
  if (env.NEXUS_CRM_LIVE_PIX_PILOT_ENABLED !== 'true') return false;
  if (action === 'charge' && env.NEXUS_CRM_LIVE_PIX_PILOT_CHARGE_ENABLED !== 'true') return false;
  return ['prepare','status','charge','verify','activate'].includes(action);
}

export function safeAsaasProductionInvoice(urlString) {
  if (typeof urlString !== 'string' || urlString.length > 2048) return null;
  try {
    const url = new URL(urlString);
    if (url.protocol !== 'https:' || !['www.asaas.com','asaas.com'].includes(url.hostname)
      || url.port || url.username || url.password || url.hash) return null;
    return url.toString();
  } catch { return null; }
}

export function assertLivePixPayment(payment, pilot) {
  if (!payment || !pilot || typeof payment !== 'object') return { ok: false, reason: 'receipt_missing' };
  if (payment.id !== pilot.provider_payment_id || payment.customer !== pilot.provider_customer_id)
    return { ok: false, reason: 'provider_binding_mismatch' };
  if (payment.externalReference !== pilot.external_reference)
    return { ok: false, reason: 'external_reference_mismatch' };
  if (payment.billingType !== 'PIX' || Math.round(Number(payment.value) * 100) !== LIVE_PIX_AMOUNT_CENTS
    || !Number.isFinite(Number(payment.value)))
    return { ok: false, reason: 'amount_or_method_mismatch' };
  if (payment.subscription || payment.installment || payment.deleted === true
    || payment.status === 'REFUNDED' || payment.status === 'REFUND_REQUESTED'
    || payment.status === 'CHARGEBACK_REQUESTED' || payment.status === 'CHARGEBACK_DISPUTE'
    || payment.status === 'AWAITING_CHARGEBACK_REVERSAL')
    return { ok: false, reason: 'subscription_or_refund_not_allowed' };
  // CONFIRMED may be provisional for some accounts; require settled status.
  if (payment.status !== 'RECEIVED') return { ok: false, reason: 'payment_not_received' };
  return { ok: true, reason: 'received' };
}

export function assertLivePixCustomer(customer, pilot) {
  if (!customer || !pilot || typeof customer !== 'object'
    || customer.id !== pilot.provider_customer_id
    || digits(customer.cpfCnpj) !== pilot.cpf) return false;
  return true;
}

export function isLivePixExternalReference(value, expectedUuid) {
  return typeof value === 'string' && value === LIVE_PIX_PILOT_PREFIX + expectedUuid
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(expectedUuid);
}
