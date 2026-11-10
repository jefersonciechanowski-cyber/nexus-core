import test from 'node:test';
import assert from 'node:assert/strict';
import {verifySstAsaasPaymentProof} from '../supabase/functions/_shared/sst-asaas-payment-proof.mjs';

const sample=()=>({
 checkout:{
  id:'123e4567-e89b-12d3-a456-426614174000',environment:'production',state:'ready',
  provider_link_id:'plink_1234567',owner_email:'responsavel@tsc.example',
  registration_number:'12345678000195',billing_type:'PIX',amount_cents:9700,
 },
 payment:{id:'pay_1234567',status:'RECEIVED',paymentLink:'plink_1234567',
  billingType:'PIX',value:97,customer:'cus_1234567',subscription:'sub_1234567'},
 link:{id:'plink_1234567',externalReference:'sst-pilot-123e4567-e89b-12d3-a456-426614174000',
   billingType:'PIX',chargeType:'RECURRENT',subscriptionCycle:'MONTHLY',value:97},
 subscription:{id:'sub_1234567',customer:'cus_1234567',status:'ACTIVE',
   cycle:'MONTHLY',value:97,nextDueDate:'2026-12-10'},
 customer:{id:'cus_1234567',cpfCnpj:'12.345.678/0001-95',email:'responsavel@tsc.example'},
 todayISO:'2026-11-09'
});
test('confirmed Asaas, matching link, subscription and payer activate same pilot',()=>{
 assert.deepEqual(verifySstAsaasPaymentProof(sample()),{
  ok:true,nextDueDate:'2026-12-10',customerId:'cus_1234567',subscriptionId:'sub_1234567'
 });
});
for(const [name,mutate,reason] of [
 ['Reject forged webhook payment status',x=>x.payment.status='PENDING','payment_invalid'],
 ['Reject wrong amount',x=>x.payment.value=99,'payment_invalid'],
 ['Reject wrong payment method',x=>x.payment.billingType='CREDIT_CARD','payment_invalid'],
 ['Reject someone else payment link',x=>x.payment.paymentLink='plink_other','payment_link_mismatch'],
 ['Reject changed checkout reference',x=>x.link.externalReference='sst-pilot-another','link_invalid'],
 ['Reject different linked value',x=>x.link.value=70,'link_invalid'],
 ['Reject different subscription cycle',x=>x.subscription.cycle='WEEKLY','subscription_invalid'],
 ['Reject inactive subscription',x=>x.subscription.status='INACTIVE','subscription_invalid'],
 ['Reject different customer',x=>x.subscription.customer='cus_other','subscription_invalid'],
 ['Reject different CPF/CNPJ',x=>x.customer.cpfCnpj='11144477735','payer_identity_mismatch'],
 ['Reject different email',x=>x.customer.email='outro@example.com','payer_identity_mismatch'],
 ['Reject expired billing period',x=>x.subscription.nextDueDate='2026-11-08','billing_period_invalid'],
 ['Reject malformed calendar date',x=>x.subscription.nextDueDate='2026-02-30','billing_period_invalid'],
 ['Reject sandbox payment in production',x=>x.checkout.environment='sandbox','checkout_invalid'],
 ['Reject unknown checkout state',x=>x.checkout.state='review','checkout_invalid'],
 ['Reject renewal from other subscription',x=>{x.checkout.state='paid';x.checkout.provider_subscription_id='sub_different'},'subscription_not_bound'],
]){
 test(name,()=>{
  const fixture=sample();mutate(fixture);
  const result=verifySstAsaasPaymentProof(fixture);
  assert.equal(result.ok,false);assert.equal(result.reason,reason);
 });
}
test('Renewal payment without link remains linked to verified subscription',()=>{
 const fixture=sample();fixture.checkout.state='paid';
 fixture.checkout.provider_subscription_id='sub_1234567';
 delete fixture.payment.paymentLink;
 assert.equal(verifySstAsaasPaymentProof(fixture).ok,true);
});
