// Nexus CRM Asaas production delinquency policy: PURE, fail-closed and
// advisory only. It cannot block a tenant, send emails or charge a customer.
// Do NOT interpret an overdue webhook as independent proof of delinquency.
export const CRM_ASAAS_RECOMMENDED_GRACE_DAYS = 7;

const decision=(status,reason,details={})=>Object.freeze({
  decision:status,reason,readOnly:true,requiresOperatorReview:true,
  canSuspendCrm:false,canChargeCustomer:false,...details,
});
const id=(value,prefix)=>typeof value==='string'
  && new RegExp('^'+prefix+'_[A-Za-z0-9_-]{5,120}$').test(value);
const money=(cents,value)=>Number.isSafeInteger(Number(cents))
  && Number(cents)>0 && typeof value==='number' && Number.isFinite(value)
  && Math.round(value*100)===Number(cents);
const digits=value=>String(value??'').replace(/\D/g,'');
const isDate=value=>typeof value==='string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value+'T12:00:00Z'))
  && new Date(Date.parse(value+'T12:00:00Z')).toISOString().slice(0,10)===value;
const epochDay=value=>Date.parse(value+'T12:00:00Z')/86400000;
const eventAt=value=>typeof value==='string'
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value))?Date.parse(value):null;

export function previewProductionCrmAsaasDelinquency({
  eventRow,sale,access,invoice,subscription,customer,productCode,
  now,graceDays=CRM_ASAAS_RECOMMENDED_GRACE_DAYS,
  policyApproved=false,
}={}) {
  const current=eventAt(now);
  if(current===null||!Number.isInteger(graceDays)||graceDays<1||graceDays>30) {
    return decision('manual_review','invalid_policy_or_clock');
  }
  if(eventRow?.provider!=='asaas'
    || !/^asaas:evt_[A-Za-z0-9_&.-]{6,150}$/.test(eventRow.provider_event_id||'')
    || eventRow.payload?.event!==eventRow.event_type
    || !['PAYMENT_OVERDUE','PAYMENT_REFUNDED','PAYMENT_RECEIVED',
         'PAYMENT_CONFIRMED','SUBSCRIPTION_DELETED','SUBSCRIPTION_UPDATED']
      .includes(eventRow.event_type)) {
    return decision('manual_review','unsupported_or_untrusted_event');
  }
  if(productCode!=='crm' || sale?.provider!=='asaas'
    || sale.environment!=='production' || sale.source!=='site-captacao'
    || sale.billing_mode!=='recurring' || sale.billing_cycle_months!==1
    || sale.sale_status!=='provisioned' || !sale.provisioned_at
    || !sale.organization_id || !id(sale.asaas_subscription_id,'sub')
    || !id(sale.provider_customer_id,'cus')
    || access?.billing_provider!=='asaas'
    || access.billing_mode!=='recurring' || access.billing_cycle_months!==1
    || access.commercial_condition!=='standard'
    || !access.external_tenant_id || access.organization_id!==sale.organization_id
    || access.product_id!==sale.product_id
    || access.provider_subscription_id!==sale.asaas_subscription_id
    || access.provider_customer_id!==sale.provider_customer_id
    || !money(sale.checkout_amount_cents,Number(access.contracted_price_cents)/100)) {
    return decision('manual_review','contract_not_eligible');
  }
  if(access.subscription_status==='cancelled' || access.access_status==='cancelled'){
    return decision('hold','terminal_cancelled');
  }
  const occurred=eventAt(eventRow.payload?.dateCreated);
  const previous=access.provider_state_event_created_at
    ?eventAt(access.provider_state_event_created_at):null;
  if(occurred===null||occurred>current+300000) {
    return decision('manual_review','event_clock_invalid');
  }
  if((previous!==null&&occurred<=previous)
    ||eventRow.provider_event_id===access.provider_state_event_id) {
    return decision('hold','duplicate_or_out_of_order');
  }
  const resource=eventRow.payload?.resource;
  if(!resource||typeof resource.id!=='string') {
    return decision('manual_review','resource_missing');
  }
  if(eventRow.event_type==='SUBSCRIPTION_DELETED'
    ||eventRow.event_type==='SUBSCRIPTION_UPDATED') {
    if(resource.id!==sale.asaas_subscription_id) {
      return decision('manual_review','subscription_not_linked');
    }
    return decision('manual_review','subscription_change_requires_manual_confirmation');
  }
  if(!id(resource.id,'pay')
    ||resource.subscription!==sale.asaas_subscription_id
    ||invoice?.id!==resource.id
    ||invoice.subscription!==sale.asaas_subscription_id
    ||invoice.customer!==sale.provider_customer_id
    ||subscription?.id!==sale.asaas_subscription_id
    ||subscription.customer!==sale.provider_customer_id
    ||customer?.id!==sale.provider_customer_id
    ||digits(customer.cpfCnpj)!==digits(sale.registration_number)
    ||![11,14].includes(digits(sale.registration_number).length)) {
    return decision('manual_review','provider_relationship_or_document_mismatch');
  }
  if(!money(access.contracted_price_cents,invoice.value)
    ||!['PIX','BOLETO'].includes(invoice.billingType)
    ||invoice.billingType!==subscription.billingType
    ||subscription.cycle!=='MONTHLY') {
    return decision('manual_review','price_or_cycle_mismatch');
  }
  if(eventRow.event_type==='PAYMENT_RECEIVED'
    ||eventRow.event_type==='PAYMENT_CONFIRMED'
    ||['RECEIVED','CONFIRMED'].includes(invoice.status)){
    // Renewal processing has a separate idempotent, receipt-first worker.
    return decision('hold','payment_resolved_by_renewal_flow');
  }
  if(eventRow.event_type==='PAYMENT_REFUNDED') {
    return decision('manual_review','refund_requires_manual_reconciliation');
  }
  // PAYMENT_OVERDUE is merely a signal. Recheck current Asaas status and the
  // due date of the *current* invoice before contemplating a suspension.
  if(invoice.status!=='OVERDUE'||!isDate(invoice.dueDate)
    ||!isDate(subscription.nextDueDate)
    ||resource.dueDate!==invoice.dueDate
    ||invoice.dueDate>subscription.nextDueDate) {
    return decision('manual_review','overdue_invoice_not_independently_confirmed');
  }
  const saoPauloToday=new Date(current-3*3600000).toISOString().slice(0,10);
  const daysLate=Math.floor(epochDay(saoPauloToday)-epochDay(invoice.dueDate));
  if(daysLate<0) return decision('manual_review','future_due_date');
  if(daysLate<graceDays) {
    return decision('hold','within_grace_period',{
      daysLate,graceDays,daysUntilReview:graceDays-daysLate,
    });
  }
  if(subscription.status==='INACTIVE'){
    return decision('manual_review','inactive_subscription_manual_review_only',{
      daysLate,graceDays,
    });
  }
  if(subscription.status!=='ACTIVE') {
    return decision('manual_review','subscription_status_uncertain');
  }
  if(policyApproved!==true) {
    return decision('hold','grace_policy_not_approved',{
      daysLate,graceDays,
    });
  }
  return decision('candidate_review','manual_suspension_review_required',{
    daysLate,graceDays,
  });
}
