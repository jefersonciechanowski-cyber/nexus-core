// Pure orchestration of CRM Asaas reservation -> optional FINANCIAL claim.
// No HTTP, email, tenant or entitlement APIs here. Database functions are
// fail-closed, service-role-only and must validate the sale atomically.
// Caller MUST independently GET payment/link/customer/subscription in Asaas
// and call this only for a verified_for_review decision.
const response=(decision,reason,details={})=>Object.freeze({
  decision,reason,canActivateCrm:false,...details,
});
const safeUuid=value=>typeof value==='string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const safeProviderId=(value,prefix)=>typeof value==='string'
  && new RegExp('^'+prefix+'_[a-zA-Z0-9_-]{5,120}$').test(value);

/** @param {{verification: any, eventId: string, environment: string, reservationEnabled: boolean, claimEnabled: boolean, callRpc:(name:string,args:Record<string,unknown>)=>Promise<{data?:any,error?:any}>}} options */
export async function reconcileCrmAsaasSettlement(options) {
  const {verification,eventId,environment,reservationEnabled,claimEnabled,callRpc}=options||{};
  if(environment!=='sandbox')return response('hold','sandbox_only');
  if(!reservationEnabled)return response('verified_for_review','reservation_disabled');
  if(!verification || verification.decision!=='verified_for_review'
    || verification.canActivateCrm!==false || !safeUuid(verification.saleId)
    || !safeProviderId(verification.paymentId,'pay')
    || !safeProviderId(verification.subscriptionId,'sub')
    || typeof eventId!=='string' || !/^asaas:evt_[A-Za-z0-9_&.-]{6,150}$/.test(eventId)
    || verification.eventId!==eventId
    || !Number.isSafeInteger(verification.amountCents)
    || verification.amountCents<=0
    || !['PIX','BOLETO'].includes(verification.billingType)
    || typeof callRpc!=='function'){
    return response('manual_review','verification_not_authorized');
  }

  let reserve;
  try {
    reserve=await callRpc('reserve_nexus_crm_asaas_verified_payment',{
      p_sale_id:verification.saleId,
      p_provider_event_id:eventId,
      p_provider_payment_id:verification.paymentId,
      p_provider_subscription_id:verification.subscriptionId,
      p_amount_cents:verification.amountCents,
      p_billing_type:verification.billingType,
    });
  }catch{
    return response('retry','reservation_rpc_failed');
  }
  if(reserve?.error)return response('retry','reservation_rpc_unavailable');
  if(reserve?.data?.decision!=='reserved_for_review'
     || reserve.data.sale_id!==verification.saleId
     || reserve.data.payment_id!==verification.paymentId){
    return response('manual_review',reserve?.data?.reason||'reservation_not_confirmed');
  }
  if(!claimEnabled)return response('reserved_for_review','financial_claim_disabled',{
    saleId:verification.saleId,paymentId:verification.paymentId,
  });
  // Separate explicit flag. The DB claim function rechecks amount, plan,
  // company/email and reservation status with locks. It cannot provision CRM.
  let claim;
  try {
    claim=await callRpc('claim_nexus_crm_asaas_provisioning',{
      p_sale_id:verification.saleId,
      p_provider_payment_id:verification.paymentId,
    });
  }catch{
    return response('retry','claim_rpc_failed');
  }
  if(claim?.error)return response('retry','claim_rpc_unavailable');
  if(!['provision_ready','already_claimed'].includes(claim?.data?.decision)
    || claim?.data?.sale_id!==verification.saleId){
    return response('manual_review',claim?.data?.reason||'claim_not_confirmed');
  }
  // Financially approved, but still NO CRM user/tenant grant or email.
  return response('ready_for_provisioning',claim.data.decision,{
    saleId:verification.saleId,paymentId:verification.paymentId,
  });
}
