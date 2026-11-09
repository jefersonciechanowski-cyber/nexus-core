// Annual Asaas payment receipt: finance-verified once, before CRM activation.
// Never accepts a monthly subscription or an unrelated provider payment.
const reject = reason => Object.freeze({ ok:false, reason });
export async function recordVerifiedCrmAsaasAnnualPayment({admin,sale,access,payment}) {
  if (!admin || !sale || !access || !payment
    || sale.provider !== 'asaas' || sale.environment !== 'production'
    || sale.sale_status !== 'paid' || sale.billing_mode !== 'prepaid'
    || sale.billing_cycle_months !== 12
    || !sale.organization_id || !access.id || access.organization_id !== sale.organization_id
    || access.billing_provider !== 'asaas' || access.billing_mode !== 'prepaid'
    || access.billing_cycle_months !== 12 || access.commercial_condition !== 'standard'
    || access.subscription_status !== 'active'
    || sale.asaas_subscription_id != null || payment.subscriptionId != null
    || !['PIX','BOLETO'].includes(payment.billingType)
    || !['CONFIRMED','RECEIVED'].includes(payment.status)
    || typeof payment.paymentId !== 'string' || !/^pay_[A-Za-z0-9_-]{5,120}$/.test(payment.paymentId)
    || typeof payment.customerId !== 'string' || !/^cus_[A-Za-z0-9_-]{5,120}$/.test(payment.customerId)
    || !Number.isSafeInteger(payment.amountCents) || payment.amountCents !== sale.checkout_amount_cents
    || payment.amountCents <= 0) return reject('unlinked_annual_payment');

  const {data:claim,error:claimError}=await admin.from('nexus_crm_asaas_production_annual_settlements')
    .select('sale_id,provider_payment_id,provider_customer_id,amount_cents,billing_type,decision')
    .eq('provider_payment_id',payment.paymentId).maybeSingle();
  if (claimError || !claim || claim.sale_id !== sale.id || claim.decision !== 'provisioning'
    || claim.provider_customer_id !== payment.customerId
    || Number(claim.amount_cents) !== payment.amountCents
    || claim.billing_type !== payment.billingType) return reject('annual_claim_invalid');

  const readReceipt=()=>admin.from('nexus_payments')
    .select('id,provider,provider_payment_id,organization_id,access_id,provider_subscription_id,provider_customer_id,billing_type,provider_status,amount_cents,currency')
    .eq('provider_payment_id',payment.paymentId).maybeSingle();
  const matches = receipt => Boolean(receipt?.id
    && receipt.provider==='asaas' && receipt.provider_payment_id===payment.paymentId
    && receipt.organization_id===sale.organization_id && receipt.access_id===access.id
    && receipt.provider_subscription_id==null && receipt.provider_customer_id===payment.customerId
    && receipt.billing_type===payment.billingType
    && Number(receipt.amount_cents)===payment.amountCents && receipt.currency==='BRL'
    && ['RECEIVED','CONFIRMED'].includes(receipt.provider_status));
  let {data:existing,error:readError}=await readReceipt();
  if (readError)return reject('receipt_lookup_failed');
  if (existing)return matches(existing) ? Object.freeze({ok:true,alreadyRecorded:true}) : reject('receipt_claimed_elsewhere');

  const now=new Date().toISOString();
  const {error:insertError}=await admin.from('nexus_payments').insert({
    organization_id:sale.organization_id,access_id:access.id,provider:'asaas',
    provider_payment_id:payment.paymentId,provider_subscription_id:null,
    provider_customer_id:payment.customerId,billing_type:payment.billingType,
    provider_status:payment.status,amount_cents:payment.amountCents,currency:'BRL',
    confirmed_at:now,received_at:payment.status==='RECEIVED'?now:null,
    external_reference:sale.external_reference||null,
  });
  if (insertError){
    ({data:existing,error:readError}=await readReceipt());
    return !readError && matches(existing) ? Object.freeze({ok:true,alreadyRecorded:true}) : reject('receipt_insert_failed');
  }
  ({data:existing,error:readError}=await readReceipt());
  if (readError || !matches(existing))return reject('receipt_not_confirmed');
  return Object.freeze({ok:true,alreadyRecorded:false});
}
