import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyCrmAsaasPayment } from '../supabase/functions/_shared/crm-asaas-provider-verification.mjs';

const sale={id:'a187d10a-86c2-4304-b571-ef3a7d0f32d1',provider:'asaas',environment:'sandbox',
  sale_status:'checkout_created',billing_mode:'recurring',billing_cycle_months:1,
  asaas_checkout_id:'plink_abc123',asaas_subscription_id:null,checkout_amount_cents:7900,
  registration_number:'12345678909'};
const eventRow={provider_event_id:'asaas:evt_12345678910111213',provider:'asaas',event_type:'PAYMENT_RECEIVED',
  payload:{event:'PAYMENT_RECEIVED',resource:{id:'pay_abc123',paymentLink:'plink_abc123',
    subscription:'sub_abc123',billingType:'PIX',value:79,status:'RECEIVED'}}};
const payment={id:'pay_abc123',paymentLink:'plink_abc123',subscription:'sub_abc123',
  customer:'cus_abc123',billingType:'PIX',value:79,status:'RECEIVED'};
const link={id:'plink_abc123',externalReference:'nexus-crm-monthly-'+sale.id,
  chargeType:'RECURRENT',subscriptionCycle:'MONTHLY',billingType:'PIX',value:79};
const customer={id:'cus_abc123',cpfCnpj:'12345678909'};
const subscription={id:'sub_abc123',customer:'cus_abc123',
  cycle:'MONTHLY',billingType:'PIX',value:79};

const verify=async (overrides={},salePatch={},eventPatch={})=>{
  const resources={'/payments/pay_abc123':payment,'/paymentLinks/plink_abc123':link,
    '/customers/cus_abc123':customer,'/subscriptions/sub_abc123':subscription,...overrides};
  const paths=[];
  const result=await verifyCrmAsaasPayment({
    eventRow:{...eventRow,...eventPatch},
    sale:{...sale,...salePatch},
    fetchResource:async path=>{paths.push(path);if(!(path in resources))throw Error('404');return resources[path];},
  });
  return {result,paths};
};

test('provider has the last word: independently check payment, link, customer document and subscription',async()=>{
  const {result,paths}=await verify();
  assert.equal(result.decision,'verified_for_review');
  assert.equal(result.paymentId,'pay_abc123');
  assert.equal(result.subscriptionId,'sub_abc123');
  assert.equal(result.amountCents,7900);
  assert.equal(result.canActivateCrm,false);
  assert.deepEqual(paths,['/payments/pay_abc123','/paymentLinks/plink_abc123',
    '/customers/cus_abc123','/subscriptions/sub_abc123']);
  assert.equal(JSON.stringify(result).includes('12345678909'),false);
});
test('never trust a webhook as payment proof if current Asaas says unpaid or refunded',async()=>{
  assert.equal((await verify({'/payments/pay_abc123':{...payment,status:'PENDING'}})).result.reason,'status_mismatch');
  assert.equal((await verify({'/payments/pay_abc123':{...payment,status:'REFUNDED'}})).result.reason,'status_mismatch');
  assert.equal((await verify({}, {},{event_type:'PAYMENT_REFUNDED'})).result.decision,'hold');
});
test('wrong customer CPF/CNPJ, subscription owner, external reference or link triggers manual review',async()=>{
  assert.equal((await verify({'/customers/cus_abc123':{...customer,cpfCnpj:'11111111111'}})).result.reason,'customer_document_mismatch');
  assert.equal((await verify({'/subscriptions/sub_abc123':{...subscription,customer:'cus_other'}})).result.reason,'provider_customer_mismatch');
  assert.equal((await verify({'/paymentLinks/plink_abc123':{...link,externalReference:'another-shop'}})).result.reason,'link_reference_mismatch');
  assert.equal((await verify({}, {asaas_subscription_id:'sub_different'})).result.reason,'subscription_conflict');
  assert.equal((await verify({'/payments/pay_abc123':{...payment,paymentLink:'plink_other'}})).result.reason,'payment_does_not_match_link_or_subscription');
});
test('provider changed monthly billing, method or price: fail closed',async()=>{
  assert.equal((await verify({'/paymentLinks/plink_abc123':{...link,chargeType:'INSTALLMENT'}})).result.reason,'recurrence_config_mismatch');
  assert.equal((await verify({'/subscriptions/sub_abc123':{...subscription,cycle:'YEARLY'}})).result.reason,'recurrence_config_mismatch');
  assert.equal((await verify({'/payments/pay_abc123':{...payment,value:119}})).result.reason,'price_mismatch');
  assert.equal((await verify({'/subscriptions/sub_abc123':{...subscription,billingType:'BOLETO'}})).result.reason,'recurrence_config_mismatch');
});
test('sandbox-only and no provider access failures can activate or modify sale',async()=>{
  assert.equal((await verify({}, {environment:'production'})).result.decision,'manual_review');
  const {result}=await verify({'/payments/pay_abc123':null});
  assert.equal(result.decision,'manual_review');
  assert.equal((await verify({}, {asaas_checkout_id:'not/is/path'})).result.decision,'manual_review');
  const source=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-verify-event/index.ts',import.meta.url),'utf8');
  assert.match(source,/NEXUS_CRM_ASAAS_VERIFY_ENABLED/);
  assert.match(source,/NEXUS_CRM_ASAAS_MONTHLY_MODE/);
  assert.match(source,/NEXUS_CRM_ASAAS_VERIFY_SECRET/);
  assert.match(source,/api-sandbox\.asaas\.com\/v3/);
  assert.match(source,/verifyCrmAsaasPayment/);
  assert.doesNotMatch(source,/from\('organization_product_access'\)|\.update\(|\.insert\(/);
});
