// Pure review of a DIFFERENT paid invoice in an existing CRM Asaas monthly
// subscription. Does not create payments, alter access, provision a tenant or
// send emails. Independently GETs provider payment/subscription/customer/link.
const held=(reason,decision='manual_review')=>Object.freeze({
  decision,reason,readOnly:true,canActivateCrm:false,
});
const id=(s,prefix)=>typeof s==='string'
  && new RegExp('^'+prefix+'_[A-Za-z0-9_-]{5,120}$').test(s);
const date=value=>typeof value==='string'
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value+'T00:00:00Z'))
  && new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
const cents=value=>typeof value==='number' && Number.isFinite(value)
  && value>0 && Math.round(value*100);

export async function previewProductionCrmAsaasRenewal({
 eventRow,sale,access,productCode,fetchResource,
}={}) {
 if(!eventRow || eventRow.provider!=='asaas'
   || !['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(eventRow.event_type)
   || eventRow.payload?.event!==eventRow.event_type
   || !/^asaas:evt_[A-Za-z0-9_&.-]{6,150}$/.test(eventRow.provider_event_id||'')
   || !eventRow.payload?.dateCreated) return held('untrusted_settlement_event');
 if(productCode!=='crm' || sale?.provider!=='asaas' || sale?.environment!=='production'
   || sale?.source!=='site-captacao' || sale?.billing_mode!=='recurring'
   || sale?.billing_cycle_months!==1 || sale?.sale_status!=='provisioned'
   || !sale?.provisioned_at || !sale.organization_id
   || !id(sale.asaas_subscription_id,'sub')
   || !sale.asaas_checkout_id || !/^[A-Za-z0-9_-]{4,120}$/.test(sale.asaas_checkout_id)
   || access?.billing_provider!=='asaas' || access?.billing_mode!=='recurring'
   || access?.billing_cycle_months!==1 || access?.commercial_condition!=='standard'
   || !access.external_tenant_id || access.subscription_status==='cancelled'
   || access.organization_id!==sale.organization_id
   || access.product_id!==sale.product_id
   || access.provider_subscription_id!==sale.asaas_subscription_id
   || !id(access.provider_customer_id||sale.provider_customer_id,'cus')
   || !Number.isSafeInteger(Number(access.contracted_price_cents))
   || Number(access.contracted_price_cents)<=0
   || Number(access.contracted_price_cents)!==Number(sale.checkout_amount_cents)
   || typeof fetchResource!=='function') return held('not_eligible_crm_production_subscription');

 const resource=eventRow.payload.resource;
 if(!id(resource?.id,'pay')
   || resource.subscription!==sale.asaas_subscription_id) return held('invoice_not_linked');

 let payment,subscription,customer,link;
 try {
  payment=await fetchResource('/payments/'+resource.id);
  subscription=await fetchResource('/subscriptions/'+sale.asaas_subscription_id);
  customer=await fetchResource('/customers/'+payment?.customer);
  link=await fetchResource('/paymentLinks/'+sale.asaas_checkout_id);
 }catch {return held('provider_lookup_unavailable','retry');}

 const customerId=access.provider_customer_id||sale.provider_customer_id;
 if(payment?.id!==resource.id
   || payment.subscription!==sale.asaas_subscription_id
   || !id(payment.customer,'cus')
   || payment.customer!==customerId
   || subscription?.id!==sale.asaas_subscription_id
   || subscription.customer!==customerId || customer?.id!==customerId
   || link?.id!==sale.asaas_checkout_id
   || (sale.provider_customer_id && sale.provider_customer_id!==customerId)) {
  return held('provider_relationship_mismatch');
 }
 const document=String(sale.registration_number||'').replace(/\D/g,'');
 if(![11,14].includes(document.length)
   ||String(customer.cpfCnpj||'').replace(/\D/g,'')!==document) {
  return held('customer_document_mismatch');
 }
 if(link?.externalReference!=='nexus-crm-monthly-'+sale.id
   ||link.chargeType!=='RECURRENT' ||link.subscriptionCycle!=='MONTHLY'
   ||subscription?.cycle!=='MONTHLY' ||subscription?.status!=='ACTIVE'
   ||!['PIX','BOLETO'].includes(payment.billingType)
   ||payment.billingType!==subscription.billingType
   ||payment.billingType!==link.billingType) return held('recurrence_not_authorized');

 if(!['RECEIVED','CONFIRMED'].includes(payment.status))return held('payment_not_settled');
 if(cents(payment.value)!==Number(access.contracted_price_cents)
   ||cents(subscription.value)!==Number(access.contracted_price_cents)
   ||cents(link.value)!==Number(access.contracted_price_cents))return held('amount_mismatch');
 if(!date(payment.dueDate)||!date(subscription.nextDueDate)
   ||subscription.nextDueDate<=payment.dueDate
   ||(resource.dueDate&&resource.dueDate!==payment.dueDate)) {
  return held('due_date_not_safe');
 }
 // This is a review, not proof of non-duplication. The service-only database
 // RPC must still atomically check this invoice vs the existing ledger.
 return Object.freeze({
  decision:'verified_renewal_for_review',readOnly:true,canActivateCrm:false,
  saleId:sale.id,accessId:access.id,eventId:eventRow.provider_event_id,
  paymentId:payment.id,subscriptionId:subscription.id,customerId,
  paymentStatus:payment.status,billingType:payment.billingType,
  amountCents:Number(access.contracted_price_cents),
  dueDate:payment.dueDate,nextDueDate:subscription.nextDueDate,
 });
}
