import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyCrmAsaasPayment } from '../supabase/functions/_shared/crm-asaas-provider-verification.mjs';
import { classifyCrmAsaasSettlement } from '../supabase/functions/_shared/crm-asaas-reconciliation.mjs';
import { decideCrmAsaasLifecycle } from '../supabase/functions/_shared/crm-asaas-lifecycle.mjs';
import {
 previewProductionCrmAsaasPayment, previewProductionCrmAsaasLifecycle,
} from '../supabase/functions/_shared/crm-asaas-production-review.mjs';

const sale={
 id:'a187d10a-86c2-4304-b571-ef3a7d0f32d1', provider:'asaas',environment:'production',
 sale_status:'checkout_created', billing_mode:'recurring',billing_cycle_months:1,
 asaas_checkout_id:'plink_prod123',asaas_subscription_id:null,
 checkout_amount_cents:7900,registration_number:'12345678909',
};
const eventRow={
 provider_event_id:'asaas:evt_prod1234567890',provider:'asaas',event_type:'PAYMENT_RECEIVED',
 payload:{event:'PAYMENT_RECEIVED',dateCreated:'2026-11-07T17:00:00.000Z',
  resource:{id:'pay_prod123',paymentLink:'plink_prod123',
    subscription:'sub_prod123',billingType:'PIX',value:79,status:'RECEIVED'}},
};
const payment={id:'pay_prod123',paymentLink:'plink_prod123',subscription:'sub_prod123',
 customer:'cus_prod123',billingType:'PIX',value:79,status:'RECEIVED'};
const link={id:'plink_prod123',externalReference:'nexus-crm-monthly-'+sale.id,
 chargeType:'RECURRENT',subscriptionCycle:'MONTHLY',billingType:'PIX',value:79};
const customer={id:'cus_prod123',cpfCnpj:'12345678909'};
const subscription={id:'sub_prod123',customer:'cus_prod123',
 cycle:'MONTHLY',billingType:'PIX',value:79,status:'ACTIVE'};
const resources={
 '/payments/pay_prod123':payment,
 '/paymentLinks/plink_prod123':link,
 '/customers/cus_prod123':customer,
 '/subscriptions/sub_prod123':subscription,
};
async function pay(extra={},options={}){
 const paths=[];
 const r=await previewProductionCrmAsaasPayment({
  eventRow:{...eventRow,...(options.event||{})},
  sale:{...sale,...(options.sale||{})},
  productCode:options.productCode??'crm',
  fetchResource:async path=>{
   paths.push(path);
   if(Object.hasOwn(extra,path))return extra[path];
   if(!(path in resources))throw Error('unknown path');
   return resources[path];
  },
 });
 return {r,paths};
}
test('production payment preview independently checks four Asaas resources but cannot grant access',async()=>{
 const {r,paths}=await pay();
 assert.equal(r.decision,'verified_for_review');
 assert.equal(r.readOnly,true);
 assert.equal(r.canActivateCrm,false);
 assert.equal(r.subscriptionId,'sub_prod123');
 assert.equal(r.amountCents,7900);
 assert.deepEqual(paths,['/payments/pay_prod123','/paymentLinks/plink_prod123',
  '/customers/cus_prod123','/subscriptions/sub_prod123']);
 assert.equal(JSON.stringify(r).includes('12345678909'),false);
});
test('sandbox remains default and never accepts a live sale without explicit environment',async()=>{
 assert.equal((await verifyCrmAsaasPayment({sale,eventRow,fetchResource:()=>{throw Error('must not fetch')}})).reason,'sale_invalid');
 assert.equal(classifyCrmAsaasSettlement(eventRow,sale,link).reason,'sale_not_safe_to_settle');
 assert.equal((await pay({}, {sale:{environment:'sandbox'}})).r.reason,'not_production_monthly_crm_sale');
 assert.equal((await pay({}, {sale:{provider:'stripe'}})).r.reason,'not_production_monthly_crm_sale');
 assert.equal((await pay({}, {productCode:'sst'})).r.reason,'not_production_monthly_crm_sale');
 const bad=await verifyCrmAsaasPayment({sale,eventRow,environment:'unknown',fetchResource:()=>{throw Error('must not fetch')}});
 assert.equal(bad.decision,'manual_review');
});
test('wrong document, amount, checkout reference, subscription owner or method fails closed',async()=>{
 for(const [resource,patch,expected] of [
  ['/customers/cus_prod123',{cpfCnpj:'11111111111'},'customer_document_mismatch'],
  ['/payments/pay_prod123',{value:25},'price_mismatch'],
  ['/paymentLinks/plink_prod123',{externalReference:'other'},'link_reference_mismatch'],
  ['/subscriptions/sub_prod123',{customer:'cus_other'},'provider_customer_mismatch'],
  ['/subscriptions/sub_prod123',{cycle:'YEARLY'},'recurrence_config_mismatch'],
  ['/payments/pay_prod123',{billingType:'BOLETO'},'recurrence_config_mismatch'],
  ['/subscriptions/sub_prod123',{status:'INACTIVE'},'production_subscription_not_active_or_payment_unsettled'],
  ['/payments/pay_prod123',{status:'PENDING'},'status_mismatch'],
 ]){
  const value={...resources[resource],...patch};
  const {r}=await pay({[resource]:value});
  assert.equal(r.reason,expected,resource);
  assert.equal(r.canActivateCrm,false);
 }
});
test('no pending or refunded webhook can be used as a settlement proof',async()=>{
 for(const type of ['PAYMENT_CREATED','PAYMENT_OVERDUE','PAYMENT_REFUNDED','PAYMENT_DELETED']){
  const {r}=await pay({}, {event:{event_type:type,payload:{...eventRow.payload,event:type}}});
  assert.equal(r.decision,'hold',type);
 }
 const {r}=await pay({}, {sale:{billing_cycle_months:12}});
 assert.equal(r.decision,'manual_review');
});

const lifeSale={...sale, sale_status:'provisioned',provisioned_at:'2026-11-01T00:00:00Z',
 organization_id:'org-one',product_id:'product-crm',asaas_subscription_id:'sub_prod123'};
const access={
 id:'access-one',organization_id:'org-one',product_id:'product-crm',
 billing_provider:'asaas',billing_mode:'recurring',commercial_condition:'standard',
 external_tenant_id:'tenant-crm',provider_subscription_id:'sub_prod123',
 provider_customer_id:'cus_prod123',subscription_status:'past_due',access_status:'suspended',
 contracted_price_cents:7900,
 provider_state_event_created_at:'2026-11-02T00:00:00Z',
 provider_state_event_id:'asaas:evt_previous_event',
};
const receipt={
 provider:'asaas',provider_payment_id:'pay_prod123',provider_subscription_id:'sub_prod123',
 organization_id:'org-one',access_id:'access-one',currency:'BRL',amount_cents:7900,
};
async function life(event=eventRow,opts={}){
 const touched=[];
 const result=await previewProductionCrmAsaasLifecycle({
  eventRow:event,sale:opts.sale||lifeSale,access:opts.access||access,
  receipt:opts.receipt===undefined?receipt:opts.receipt,
  productCode:opts.productCode??'crm',
  now:'2026-11-07T18:00:00Z',
  fetchResource:async path=>{
   touched.push(path);if(!(path in resources))throw Error('unknown path');return resources[path];
  },
 });
 return {result,touched};
}
test('linked monthly renewal can only SUGGEST reactivation after verification',async()=>{
 const {result,touched}=await life();
 assert.deepEqual([result.decision,result.action,result.readOnly,result.canActivateCrm],
  ['candidate','reactivate',true,false]);
 assert.deepEqual(touched,['/subscriptions/sub_prod123','/payments/pay_prod123','/customers/cus_prod123']);
});
test('overdue never suspends until grace policy approved, even with production event',async()=>{
 const e={...eventRow,event_type:'PAYMENT_OVERDUE',
  payload:{...eventRow.payload,event:'PAYMENT_OVERDUE'}};
 const {result,touched}=await life(e);
 assert.deepEqual([result.decision,result.reason,result.readOnly],['hold','await_explicit_grace_policy',true]);
 assert.deepEqual(touched,[]);
});
test('renewal without independently linked receipt, or wrong org, remains in review',async()=>{
 const missing=await life(eventRow,{receipt:null});
 assert.equal(missing.result.reason,'payment_not_in_verified_ledger');
 const other=await life(eventRow,{access:{...access,organization_id:'org-two'}});
 assert.equal(other.result.reason,'contract_not_eligible_or_courtesy');
 const courtesy=await life(eventRow,{access:{...access,commercial_condition:'courtesy'}});
 assert.equal(courtesy.result.reason,'not_production_monthly_crm_access');
 const wrongProduct=await life(eventRow,{productCode:'sst'});
 assert.equal(wrongProduct.result.reason,'not_production_monthly_crm_access');
 const sandbox=await life(eventRow,{sale:{...lifeSale,environment:'sandbox'}});
 assert.equal(sandbox.result.reason,'not_production_monthly_crm_access');
});
test('production preview module has no fetch, SQL, secret or mutation methods',()=>{
 const src=readFileSync(new URL('../supabase/functions/_shared/crm-asaas-production-review.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(src,/\bawait fetch\(|\bcreateClient\(|\badmin\.rpc\(|\.(?:insert|update|upsert|delete)\(/);
 assert.doesNotMatch(src,/Deno\.env\.get\(|ASAAS_API_KEY|STRIPE_SECRET_KEY|\/v3\/paymentLinks/);
 assert.match(src,/environment: 'production'/);
 assert.match(src,/readOnly: true, canActivateCrm: false/);
});
