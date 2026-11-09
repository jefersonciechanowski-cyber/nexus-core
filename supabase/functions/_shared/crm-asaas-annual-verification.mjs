import { quoteCrmBlackFridayAnnual } from './crm-asaas-black-friday-annual-contract.mjs';

// Pure annual verification. The caller supplies ONLY real Asaas production GET
// snapshots; a webhook alone can never authorize 12 months of CRM access.
const validId=(value,prefix)=>typeof value==='string'
  && new RegExp('^'+prefix+'_[A-Za-z0-9_-]{5,120}$').test(value);
const cents=value=>typeof value==='number' && Number.isFinite(value)
  && value>0 && Number.isSafeInteger(Math.round(value*100))
  ? Math.round(value*100) : null;
const reject=(reason,decision='manual_review')=>Object.freeze({
  decision,reason,canActivateCrm:false,
});

export async function verifyProductionCrmAsaasAnnual({
  eventRow,sale,plan,fetchResource
}={}) {
  if(!eventRow || !['PAYMENT_CONFIRMED','PAYMENT_RECEIVED'].includes(eventRow.event_type)
    ||eventRow.environment!=='production' || eventRow.provider!=='asaas'
    ||!validId(eventRow.resource_id,'pay')
    ||eventRow.payload?.resource?.id!==eventRow.resource_id
    ||eventRow.payload?.resource?.paymentLink!==sale?.asaas_checkout_id
    ||eventRow.payload?.resource?.subscription != null)
    return reject('annual_event_relationship_invalid');
  if(!sale || sale.provider!=='asaas' || sale.environment!=='production'
    ||sale.source!=='site-captacao' ||sale.billing_mode!=='prepaid'
    ||sale.billing_cycle_months!==12 ||sale.sale_status!=='checkout_created'
    ||sale.asaas_subscription_id != null ||sale.organization_id != null ||sale.user_id != null
    ||typeof sale.id!=='string' ||!validId(sale.asaas_checkout_id,'plink') && !validId(sale.asaas_checkout_id,'pml')
      && !/^[A-Za-z0-9_-]{4,120}$/.test(sale.asaas_checkout_id || ''))
    return reject('annual_sale_not_new');
  let offer;
  try{offer=quoteCrmBlackFridayAnnual(plan);}catch{return reject('annual_plan_invalid');}
  if(offer.annualAmountCents!==Number(sale.checkout_amount_cents)
    ||plan.id!==sale.plan_id)
    return reject('annual_price_or_plan_changed');
  if(typeof fetchResource!=='function')return reject('provider_reader_missing');
  const paymentId=eventRow.resource_id;
  let payment,link,customer;
  try{
    payment=await fetchResource('/payments/'+paymentId);
    link=await fetchResource('/paymentLinks/'+sale.asaas_checkout_id);
    if(!validId(payment?.customer,'cus'))return reject('payment_customer_missing');
    customer=await fetchResource('/customers/'+payment.customer);
  }catch{return reject('provider_lookup_failed','retry');}
  if(payment?.id!==paymentId || payment?.paymentLink!==sale.asaas_checkout_id
    ||payment?.subscription != null ||link?.id!==sale.asaas_checkout_id
    ||link.active===false ||link.chargeType!=='DETACHED'
    ||link.externalReference!=='nexus-crm-bf-annual-'+sale.id)
    return reject('not_verified_annual_detached_payment');
  // The prepaid expiry RPC requires a durable RECEIVED receipt. A merely
  // CONFIRMED payment must be retried later, never granted 12 months early.
  if(payment.status==='CONFIRMED')return reject('await_provider_receipt','retry');
  if(payment.status!=='RECEIVED')return reject('provider_payment_not_settled');
  if(!['PIX','BOLETO'].includes(payment.billingType)
    ||payment.billingType!==link.billingType
    ||cents(payment.value)!==offer.annualAmountCents
    ||cents(link.value)!==offer.annualAmountCents)
    return reject('annual_payment_amount_method_mismatch');
  if(customer?.id!==payment.customer
    ||String(customer.cpfCnpj||'').replace(/\D/g,'')
       !==String(sale.registration_number||'').replace(/\D/g,''))
    return reject('payer_document_mismatch');
  return Object.freeze({
    decision:'verified_for_settlement',
    saleId:sale.id,eventId:eventRow.provider_event_id,paymentId:payment.id,
    customerId:payment.customer,billingType:payment.billingType,
    paymentStatus:payment.status,amountCents:offer.annualAmountCents,
    billingCycleMonths:12,canActivateCrm:false,
  });
}
