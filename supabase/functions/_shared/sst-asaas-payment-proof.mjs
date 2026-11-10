// Pure, side-effect-free SST pilot settlement proof. No credentials, no DB.
// Do not accept webhook payloads as this input: all resources must come from
// independent authenticated Asaas GETs, not the browser or webhook.
const safe=(value,max=255)=>String(value??'').trim().slice(0,max);
const digits=(value)=>safe(value,50).replace(/\D/g,'');
const validId=(value)=>typeof value==='string'&&/^[A-Za-z0-9_&.-]{5,160}$/.test(value);
const sameAmount=(value,cents)=>{
  const n=Number(value),target=Number(cents);
  return Number.isFinite(n)&&Number.isSafeInteger(target)&&target>0&&Math.round(n*100)===target;
};
const rejection=reason=>({ok:false,reason});
export function verifySstAsaasPaymentProof({checkout,payment,link,subscription,customer,todayISO}){
  if(!checkout||!payment||!link||!subscription||!customer)return rejection('resource_missing');
  if(checkout.environment!=='production'
    ||!['ready','paid'].includes(checkout.state)
    ||!validId(checkout.provider_link_id)
    ||!validId(payment.id))return rejection('checkout_invalid');
  if(!['CONFIRMED','RECEIVED'].includes(payment.status)
    ||!sameAmount(payment.value,checkout.amount_cents)
    ||payment.billingType!==checkout.billing_type
    ||!['PIX','BOLETO'].includes(payment.billingType)
  )return rejection('payment_invalid');
  if(!validId(payment.subscription)||!validId(payment.customer))
    return rejection('payment_reference_missing');
  if(checkout.state==='ready' && payment.paymentLink!==checkout.provider_link_id)
    return rejection('payment_link_mismatch');
  if(checkout.state==='paid' && checkout.provider_subscription_id!==payment.subscription)
    return rejection('subscription_not_bound');

  if(link.id!==checkout.provider_link_id
    ||link.externalReference!=='sst-pilot-'+checkout.id
    ||link.chargeType!=='RECURRENT'||link.subscriptionCycle!=='MONTHLY'
    ||link.billingType!==checkout.billing_type
    ||!sameAmount(link.value,checkout.amount_cents))
    return rejection('link_invalid');

  if(subscription.id!==payment.subscription||subscription.customer!==payment.customer
    ||subscription.status!=='ACTIVE'||subscription.cycle!=='MONTHLY'
    ||!sameAmount(subscription.value,checkout.amount_cents))
    return rejection('subscription_invalid');

  if(customer.id!==payment.customer
    ||digits(customer.cpfCnpj)!==checkout.registration_number
    ||safe(customer.email).toLowerCase()!==safe(checkout.owner_email).toLowerCase())
    return rejection('payer_identity_mismatch');

  const due=safe(subscription.nextDueDate,20);
  const today=safe(todayISO,10);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(due)
    ||!(/^\d{4}-\d{2}-\d{2}$/.test(today))
    ||!Number.isFinite(Date.parse(due+'T12:00:00Z'))
    ||new Date(due+'T12:00:00Z').toISOString().slice(0,10)!==due
    ||due<today)return rejection('billing_period_invalid');
  return {ok:true,nextDueDate:due,customerId:payment.customer,subscriptionId:payment.subscription};
}
