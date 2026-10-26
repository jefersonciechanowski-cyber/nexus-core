// Record a provider-verified Asaas payment against its exact CRM contract.
// Called ONLY after the atomic financial claim has set provision_ready, after
// the new organization/access exists but BEFORE creating CRM tenant or email.
// No network access, no implicit activation, no overwrite of existing payments.
const reject=reason=>Object.freeze({ok:false,reason});

export async function recordVerifiedCrmAsaasPayment({admin,sale,access,payment}) {
  if(!admin || !sale || !access || !payment
    || sale.provider!=='asaas' || sale.environment!=='sandbox'
    || sale.sale_status!=='paid' || sale.billing_mode!=='recurring'
    || sale.billing_cycle_months!==1
    || !sale.id || !sale.organization_id || !access.id
    || access.organization_id!==sale.organization_id
    || access.billing_provider!=='asaas'
    || access.commercial_condition!=='standard'
    || access.subscription_status!=='active'
    || !['PIX','BOLETO'].includes(payment.billingType)
    || !['CONFIRMED','RECEIVED'].includes(payment.status)
    || typeof payment.paymentId!=='string' || !/^pay_[a-zA-Z0-9_-]{5,120}$/.test(payment.paymentId)
    || typeof payment.subscriptionId!=='string' || !/^sub_[a-zA-Z0-9_-]{5,120}$/.test(payment.subscriptionId)
    || sale.asaas_subscription_id!==payment.subscriptionId
    || !Number.isSafeInteger(payment.amountCents)
    || payment.amountCents<=0 || payment.amountCents!==sale.checkout_amount_cents
    || typeof payment.customerId!=='string' || !/^cus_[a-zA-Z0-9_-]{5,120}$/.test(payment.customerId)) {
      return reject('unverified_or_unlinked_payment');
  }
  const {data:claim,error:claimError}=await admin.from('nexus_crm_asaas_verified_payments')
    .select('sale_id,provider_payment_id,provider_subscription_id,amount_cents,billing_type,decision')
    .eq('provider_payment_id',payment.paymentId).maybeSingle();
  if(claimError) return reject('claim_lookup_failed');
  if(!claim || claim.sale_id!==sale.id || claim.provider_subscription_id!==payment.subscriptionId
    || Number(claim.amount_cents)!==payment.amountCents
    || claim.billing_type!==payment.billingType || claim.decision!=='provision_ready'){
    return reject('claim_not_provision_ready');
  }
  const getExisting=()=>admin.from('nexus_payments')
    .select('id,provider,provider_payment_id,organization_id,access_id,provider_subscription_id,provider_customer_id,billing_type,provider_status,amount_cents,currency')
    .eq('provider_payment_id',payment.paymentId).maybeSingle();
  let {data:existing,error:readError}=await getExisting();
  if(readError) return reject('payment_read_failed');
  const matches=row=>row?.id && row.provider==='asaas'
    && row.provider_payment_id===payment.paymentId
    && row.organization_id===sale.organization_id
    && row.access_id===access.id
    && row.provider_subscription_id===payment.subscriptionId
    && row.provider_customer_id===payment.customerId
    && row.billing_type===payment.billingType
    && Number(row.amount_cents)===payment.amountCents
    && row.currency==='BRL'
    && ['RECEIVED','CONFIRMED'].includes(row.provider_status);
  if(existing) return matches(existing)
    ? Object.freeze({ok:true,alreadyRecorded:true,paymentId:payment.paymentId})
    : reject('provider_payment_claimed_elsewhere');

  // Unique (provider_payment_id) at DB level is still the final arbiter if
  // two processes race after this read. Re-read on constraint violation.
  const now=new Date().toISOString();
  const {error:insertError}=await admin.from('nexus_payments').insert({
    organization_id:sale.organization_id,access_id:access.id,provider:'asaas',
    provider_payment_id:payment.paymentId,
    provider_subscription_id:payment.subscriptionId,
    provider_customer_id:payment.customerId,
    billing_type:payment.billingType,provider_status:payment.status,
    amount_cents:payment.amountCents,currency:'BRL',
    confirmed_at:now,received_at:payment.status==='RECEIVED'?now:null,
    external_reference:sale.external_reference||null,
  });
  if(insertError){
    const reread=await getExisting();
    existing=reread.data;
    if(!reread.error && matches(existing)){
      return Object.freeze({ok:true,alreadyRecorded:true,paymentId:payment.paymentId});
    }
    return reject('payment_insert_or_conflict');
  }
  // Ensure the write is visible and belongs to the same company.
  const reread=await getExisting();
  if(reread.error||!matches(reread.data))return reject('payment_receipt_not_confirmed');
  return Object.freeze({ok:true,alreadyRecorded:false,paymentId:payment.paymentId});
}
