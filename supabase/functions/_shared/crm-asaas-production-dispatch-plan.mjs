// Pure, deterministic routing for authenticated and persisted Asaas CRM events.
// A route is NOT a payment receipt or permission to grant an entitlement.
// Workers must independently GET live Asaas records and apply atomic DB locks.
const id=(value,prefix,min=5,max=120)=>typeof value==='string' &&
  new RegExp('^'+prefix+'_[A-Za-z0-9_-]{'+min+','+max+'}$').test(value);

/** @param {string} decision @param {string} reason
 * @param {'provision'|'renewal'|'annual'|'upgrade'|null} [worker] */
const result=(decision,reason,worker=null)=>Object.freeze({
  decision,reason,worker,canCharge:false,canProvision:false,
  independentlyVerified:false,
});

/**
 * @param {{eventRow?:any,sales?:any[],productCode?:string}} options
 */
export function planCrmAsaasProductionDispatch({eventRow,sales=[],productCode}={}) {
  if(eventRow?.environment!=='production' || eventRow?.processing_status!=='pending'
    || !/^asaas:evt_[A-Za-z0-9_&.-]{6,150}$/.test(eventRow.provider_event_id||'')) {
    return result('hold','not_pending_production_event');
  }
  const type=eventRow.event_type;
  const envelope=eventRow.payload;
  const resource=envelope?.resource;
  if(!resource||typeof type!=='string'||envelope?.event!==type
    ||eventRow.resource_id!==resource.id
    ||envelope.id!==eventRow.provider_event_id.slice(6)) {
    return result('manual_review','event_envelope_inconsistent');
  }
  if(!['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(type)) {
    // Never act on overdue/refund/chargeback/cancellation or new event types
    // automatically: each requires independent operator review.
    return result('manual_review','non_settlement_event');
  }
  if(!id(resource.id,'pay'))return result('manual_review','payment_id_invalid');
  const link=id(resource.paymentLink,'plink',4,120)
    ||id(resource.paymentLink,'pml',4,120)
    ||(typeof resource.paymentLink==='string'
      &&/^[A-Za-z0-9_-]{4,120}$/.test(resource.paymentLink));
  const sub=id(resource.subscription,'sub');
  if(!link&&!sub)return result('manual_review','payment_relationship_missing');
  if(!Array.isArray(sales)||sales.length!==1)
    return result('manual_review','sale_match_not_unique');
  const sale=sales[0];
  if(productCode==='crm'&&sale?.source==='crm-trial-upgrade'
    &&sale.provider==='asaas'&&sale.environment==='production'
    &&sale.billing_mode==='recurring'&&sale.billing_cycle_months===1
    &&['checkout_created','paid'].includes(sale.sale_status)){
    if(!link||!sub||sale.asaas_checkout_id!==resource.paymentLink)
      return result('manual_review','upgrade_relationship_invalid');
    return result('route_for_independent_verification','authenticated_trial_upgrade','upgrade');
  }
  if(productCode==='crm' && sale?.provider==='asaas'
    && sale.environment==='production' && sale.billing_mode==='prepaid'
    && sale.billing_cycle_months===12 && sale.product_id && sale.id){
    if(!link || sub || sale.asaas_checkout_id!==resource.paymentLink
      || sale.asaas_subscription_id != null)
      return result('manual_review','annual_relationship_invalid');
    if(sale.sale_status!=='checkout_created')
      return result('manual_review','annual_sale_not_fresh');
    return result('route_for_independent_verification','verified_annual_candidate','annual');
  }
  if(productCode!=='crm' || sale?.provider!=='asaas' || sale.environment!=='production'
    ||sale.billing_mode!=='recurring'||sale.billing_cycle_months!==1
    ||!sale.product_id||!sale.id) {
    return result('manual_review','not_monthly_production_crm');
  }
  const linkedLink=!!link && sale.asaas_checkout_id===resource.paymentLink;
  const linkedSub=!!sub && sale.asaas_subscription_id===resource.subscription;
  if(!linkedLink&&!linkedSub)
    return result('manual_review','sale_relationship_mismatch');
  if(sale.sale_status==='provisioned') {
    if(!linkedSub)return result('manual_review','renewal_subscription_mismatch');
    return result('route_for_independent_verification','provisioned_sale_renewal','renewal');
  }
  if(sale.sale_status==='checkout_created'||sale.sale_status==='paid') {
    if(!linkedLink)return result('manual_review','new_sale_checkout_mismatch');
    if(sale.sale_status==='paid' && !sale.paid_at)
      return result('manual_review','paid_sale_receipt_missing');
    return result('route_for_independent_verification','paid_event_new_sale','provision');
  }
  return result('manual_review','sale_not_eligible');
}

