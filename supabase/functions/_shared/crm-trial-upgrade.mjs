import { buildCrmAsaasRecurringLink } from './crm-asaas-monthly-contract.mjs';

const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const date=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const pid=(v,p)=>typeof v==='string'&&new RegExp('^'+p+'_[A-Za-z0-9_-]{5,120}$').test(v);
export function normalizeTrialUpgrade(input){
 if(!input||input.action!=='crm-trial-paid-upgrade-v1'||input.acceptedTerms!==true
  ||!uuid(input.crmOrganizationId)||!uuid(input.actorUserId)
  ||typeof input.actorEmail!=='string'||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.actorEmail)
  ||!['start','pro','gestao'].includes(input.planCode)
  ||!['PIX','BOLETO'].includes(input.paymentMethod))return null;
 return {crmOrganizationId:input.crmOrganizationId,actorUserId:input.actorUserId,
  actorEmail:input.actorEmail.toLowerCase(),planCode:input.planCode,paymentMethod:input.paymentMethod};
}
export function eligibleTrialUpgrade({input,organization,access,claim,plan}){
 return !!input&&!!organization&&!!access&&!!claim&&!!plan
  &&organization.id===access.organization_id&&organization.status==='active'
  &&String(organization.email).toLowerCase()===input.actorEmail
  &&access.external_tenant_id===input.crmOrganizationId
  &&access.commercial_condition==='standard'&&Number(access.contracted_price_cents)===0
  &&access.billing_provider==null&&access.provider_subscription_id==null
  &&((access.subscription_status==='trial'&&['active','suspended'].includes(access.access_status))
   ||(access.subscription_status==='past_due'&&access.access_status==='suspended'&&access.last_payment_status==='trial_expired'))
  &&claim.organization_id===organization.id&&claim.access_id===access.id
  &&claim.state==='provisioned'&&claim.trial_days===15
  &&plan.product_id===access.product_id&&plan.code===input.planCode
  &&plan.status==='active'&&plan.public_visible===true&&plan.currency==='BRL'
  &&plan.billing_interval_months===1&&Number.isSafeInteger(plan.price_cents)&&plan.price_cents>0;
}
export function buildTrialUpgradeLink({plan,method,saleId}){
 return {...buildCrmAsaasRecurringLink({plan,method,saleId}),limit:1,
  externalReference:'nexus-crm-trial-upgrade-'+saleId};
}
export function safeUpgradeUrl(value){
 try{const u=new URL(value);return u.protocol==='https:'&&['asaas.com','www.asaas.com'].includes(u.hostname)
  &&!u.username&&!u.password&&!u.port&&!u.hash&&u.pathname!=='/'?u.toString():null;}catch{return null;}
}
export async function verifyTrialUpgradePayment({event,sale,plan,fetchResource}){
 const deny=(reason,decision='manual_review')=>({decision,reason});
 if(event?.provider!=='asaas'||event.environment!=='production'||event.processing_status!=='pending'
  ||!['PAYMENT_CONFIRMED','PAYMENT_RECEIVED'].includes(event.event_type)
  ||event.payload?.event!==event.event_type
  ||!/^asaas:evt_[A-Za-z0-9_&.-]{6,150}$/.test(event.provider_event_id||'')
  ||!pid(event.resource_id,'pay')||event.payload?.resource?.id!==event.resource_id
  ||sale?.source!=='crm-trial-upgrade'||sale.provider!=='asaas'||sale.environment!=='production'
  ||!['checkout_created','paid','provisioned'].includes(sale.sale_status)
  ||sale.billing_mode!=='recurring'||sale.billing_cycle_months!==1||!uuid(sale.organization_id)
  ||sale.plan_id!==plan?.id||sale.product_id!==plan?.product_id||plan.status!=='active'
  ||plan.currency!=='BRL'||plan.billing_interval_months!==1
  ||!Number.isSafeInteger(plan.price_cents)||plan.price_cents<=0
  ||sale.checkout_amount_cents!==plan.price_cents
  ||event.payload?.resource?.paymentLink!==sale.asaas_checkout_id)return deny('upgrade_relationship_invalid');
 let payment,link,subscription,customer;
 try{
  payment=await fetchResource('/payments/'+event.resource_id);
  if(!pid(payment?.subscription,'sub')||!pid(payment?.customer,'cus'))return deny('upgrade_provider_ids_invalid');
  [link,subscription,customer]=await Promise.all([
   fetchResource('/paymentLinks/'+sale.asaas_checkout_id),
   fetchResource('/subscriptions/'+payment.subscription),fetchResource('/customers/'+payment.customer)]);
 }catch{return deny('provider_unavailable','retry');}
 if(payment.status==='CONFIRMED')return deny('await_receipt','retry');
 if(payment.id!==event.resource_id||payment.status!=='RECEIVED'||payment.deleted===true
  ||payment.subscription!==event.payload.resource.subscription
  ||payment.paymentLink!==sale.asaas_checkout_id||link.id!==sale.asaas_checkout_id
  ||link.externalReference!=='nexus-crm-trial-upgrade-'+sale.id||link.chargeType!=='RECURRENT'
  ||link.subscriptionCycle!=='MONTHLY'||link.limit!==1
  ||!['PIX','BOLETO'].includes(payment.billingType)||link.billingType!==payment.billingType
  ||subscription.id!==payment.subscription||subscription.customer!==payment.customer
  ||subscription.paymentLink!==link.id||subscription.cycle!=='MONTHLY'||subscription.deleted===true
  ||subscription.billingType!==payment.billingType||subscription.status!=='ACTIVE'
  ||customer.id!==payment.customer||!String(sale.registration_number||'')
  ||String(customer.cpfCnpj||'').replace(/\D/g,'')!==sale.registration_number
  ||[payment.value,link.value,subscription.value].some(v=>typeof v!=='number'||Math.round(v*100)!==plan.price_cents)
  ||(sale.asaas_subscription_id!=null&&sale.asaas_subscription_id!==subscription.id))return deny('upgrade_receipt_not_verified');
 if(!date(payment.dueDate)||!date(subscription.nextDueDate)||subscription.nextDueDate<=payment.dueDate
  ||(Date.parse(subscription.nextDueDate)-Date.parse(payment.dueDate))/86400000>90)return deny('upgrade_dates_invalid');
 return {decision:'verified',paymentId:payment.id,subscriptionId:subscription.id,
  customerId:customer.id,dueDate:payment.dueDate,nextDueDate:subscription.nextDueDate,amountCents:plan.price_cents,billingType:payment.billingType};
}
