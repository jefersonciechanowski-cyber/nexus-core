import { decideCrmAsaasLifecycle } from './crm-asaas-lifecycle.mjs';

// Pure preview. Only reads vetted snapshots and authenticated Asaas GET results.
// No ledger mutation, invoice creation, entitlement sync or customer PII output.
const result=(decision,reason,details={})=>Object.freeze({
  decision,reason,readOnly:true,canActivateCrm:false,...details,
});
const id=(value,prefix)=>typeof value==='string'
  && new RegExp('^'+prefix+'_[A-Za-z0-9_-]{5,120}$').test(value);
const digits=value=>String(value??'').replace(/\D/g,'');
const money=(cents,amount)=>Number.isSafeInteger(Number(cents)) && Number(cents)>0
  && typeof amount==='number' && Number.isFinite(amount)
  && Math.round(amount*100)===Number(cents);
const inspectedTypes=new Set([
  'PAYMENT_RECEIVED','PAYMENT_CONFIRMED','PAYMENT_REFUNDED',
  'SUBSCRIPTION_INACTIVATED',
]);

/**
 * Independently read current payment, subscription, and customer at Asaas
 * before suggesting (but NEVER applying) a lifecycle transition.
 *
 * fetchResource is server-only, authenticated, allowlisted and Sandbox-bound.
 * sale/access/receipt come solely from restricted Supabase reads, never client input.
 */
export async function previewCrmAsaasLifecycle({eventRow,sale,access,receipt,
  productCode,fetchResource,now}={}) {
  if(eventRow?.provider!=='asaas'
    || typeof eventRow.provider_event_id!=='string'
    || !/^asaas:evt_[A-Za-z0-9_&.-]{6,150}$/.test(eventRow.provider_event_id)
    || eventRow.payload?.event!==eventRow.event_type
    || !eventRow.payload?.dateCreated) return result('manual_review','event_not_trusted');
  if(eventRow.event_type==='PAYMENT_OVERDUE') {
    return result('hold','await_explicit_grace_policy');
  }
  if(eventRow.event_type==='SUBSCRIPTION_DELETED') {
    return result('hold','subscription_deletion_requires_independent_confirmation');
  }
  if(eventRow.event_type?.startsWith('PAYMENT_CHARGEBACK')) {
    return result('manual_review','chargeback_requires_manual_review');
  }
  if(!inspectedTypes.has(eventRow.event_type)) return result('hold','unsupported_transition');
  if(!sale || !access || productCode!=='crm'
    || sale.provider!=='asaas' || sale.environment!=='sandbox'
    || sale.sale_status!=='provisioned' || !sale.provisioned_at
    || sale.billing_mode!=='recurring' || sale.billing_cycle_months!==1
    || !sale.organization_id || !sale.asaas_subscription_id
    || access.product_id!==sale.product_id
    || access.organization_id!==sale.organization_id
    || access.billing_provider!=='asaas'
    || access.billing_mode!=='recurring'
    || access.commercial_condition!=='standard'
    || !access.external_tenant_id
    || access.provider_subscription_id!==sale.asaas_subscription_id) {
    return result('manual_review','contract_not_eligible_or_courtesy');
  }

  const resource=eventRow.payload?.resource;
  const subscriptionId=sale.asaas_subscription_id;
  if(!id(subscriptionId,'sub') || !resource
    || (eventRow.event_type.startsWith('SUBSCRIPTION_')
      ? resource.id!==subscriptionId
      : resource.subscription!==subscriptionId)) {
    return result('manual_review','event_subscription_mismatch');
  }
  const isPayment=eventRow.event_type.startsWith('PAYMENT_');
  if(isPayment && (!id(resource.id,'pay') || !receipt
    || receipt.provider!=='asaas'
    || receipt.provider_payment_id!==resource.id
    || receipt.provider_subscription_id!==subscriptionId
    || receipt.organization_id!==access.organization_id
    || receipt.access_id!==access.id
    || receipt.currency!=='BRL'
    || Number(receipt.amount_cents)!==Number(access.contracted_price_cents))) {
    return result('manual_review','payment_not_in_verified_ledger');
  }
  if(typeof fetchResource!=='function') return result('retry','provider_reader_missing');
  let subscription,payment,customer;
  try {
    subscription=await fetchResource('/subscriptions/'+subscriptionId);
    if(isPayment) payment=await fetchResource('/payments/'+resource.id);
    const customerId=subscription?.customer;
    if(!id(customerId,'cus')) return result('manual_review','provider_customer_missing');
    customer=await fetchResource('/customers/'+customerId);
  }catch {
    return result('retry','provider_lookup_failed');
  }
  if(subscription?.id!==subscriptionId || !id(subscription?.customer,'cus')
    || customer?.id!==subscription.customer
    || (access.provider_customer_id && access.provider_customer_id!==subscription.customer)
    || (sale.provider_customer_id && sale.provider_customer_id!==subscription.customer)) {
    return result('manual_review','provider_relationship_mismatch');
  }
  const expectedDocument=digits(sale.registration_number);
  if(![11,14].includes(expectedDocument.length)
    || digits(customer?.cpfCnpj)!==expectedDocument) {
    return result('manual_review','customer_document_mismatch');
  }
  if(isPayment && (payment?.id!==resource.id
    || payment.subscription!==subscriptionId
    || payment.customer!==subscription.customer
    || !money(receipt.amount_cents,payment.value))) {
    return result('manual_review','provider_payment_mismatch');
  }

  const decision=decideCrmAsaasLifecycle({
    event:{
      ...eventRow,
      occurredAt:eventRow.payload.dateCreated,
      relatedPaymentId:isPayment?resource.id:null,
    },
    sale,
    access:{
      ...access,
      product_code:'crm',
      knownProviderPaymentId:isPayment?receipt.provider_payment_id:null,
    },
    payment:isPayment?payment:null,
    subscription,
    now,
    verifiedDeletion:false,
  });
  if(decision.decision!=='candidate') {
    return result(decision.decision,decision.reason||'lifecycle_not_eligible');
  }
  if(!['reactivate','suspend'].includes(decision.action)) {
    return result('manual_review','unsupported_lifecycle_action');
  }
  // Suggestions alone never invoke the SQL lifecycle mutation or tenant sync.
  return result('candidate','preview_only',{
    action:decision.action,
    subscriptionStatus:decision.subscriptionStatus,
    accessStatus:decision.accessStatus,
  });
}
