// Read-only production decision engine, not a payment / provisioning worker.
// This file cannot call Asaas, execute SQL, create a payment, or grant access.
// Its caller MUST supply independently verified Asaas GET responses, fetched
// from a fixed PRODUCTION host with a server-only production credential.
import { verifyCrmAsaasPayment } from './crm-asaas-provider-verification.mjs';
import { previewCrmAsaasLifecycle } from './crm-asaas-lifecycle-preview.mjs';

const review = (reason) => Object.freeze({
  decision: 'manual_review', reason, readOnly: true, canActivateCrm: false,
});

const enforceReadonly = (decision) => Object.freeze({
  ...decision, readOnly: true, canActivateCrm: false,
});

/**
 * This can validate a real Asaas monthly payment without creating another.
 * An existing Central sale and four independent Asaas resource snapshots are
 * required. This does NOT claim money, create access or approve live rollout.
 */
export async function previewProductionCrmAsaasPayment({
  eventRow, sale, productCode, fetchResource,
} = {}) {
  if (productCode !== 'crm' || sale?.provider !== 'asaas'
    || sale?.environment !== 'production'
    || sale?.billing_mode !== 'recurring'
    || sale?.billing_cycle_months !== 1
    || !Number.isSafeInteger(Number(sale.checkout_amount_cents))
    || Number(sale.checkout_amount_cents) <= 0) {
    return review('not_production_monthly_crm_sale');
  }
  const checked = await verifyCrmAsaasPayment({
    eventRow, sale, fetchResource, environment: 'production',
  });
  if (checked.decision !== 'verified_for_review') return enforceReadonly(checked);

  // This is stricter than the sandbox pilot. Never propose a live settlement
  // for an inactive/unknown subscription, even when payment itself is marked paid.
  if (checked.subscriptionStatus !== 'ACTIVE'
    || !['RECEIVED','CONFIRMED'].includes(checked.paymentStatus)) {
    return review('production_subscription_not_active_or_payment_unsettled');
  }
  return enforceReadonly(checked);
}

/**
 * Preview cancellation, refund, overdue or an independently linked renewal.
 * No webhook is treated as proof by itself; payment/subscription/customer
 * snapshots must be fetched separately and the ledger receipt already exist.
 * In particular, PAYMENT_OVERDUE is held until grace terms are approved.
 */
export async function previewProductionCrmAsaasLifecycle({
  eventRow, sale, access, receipt, productCode, fetchResource, now,
} = {}) {
  if (sale?.environment !== 'production'
    || sale?.provider !== 'asaas'
    || sale?.billing_mode !== 'recurring'
    || access?.billing_provider !== 'asaas'
    || access?.billing_mode !== 'recurring'
    || access?.commercial_condition !== 'standard'
    || productCode !== 'crm') return review('not_production_monthly_crm_access');

  const decision = await previewCrmAsaasLifecycle({
    eventRow,sale,access,receipt,productCode,fetchResource,now,
    environment:'production',
  });
  return enforceReadonly(decision);
}
