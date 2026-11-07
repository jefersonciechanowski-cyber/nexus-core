import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {previewProductionCrmAsaasRenewal}
 from '../supabase/functions/_shared/crm-asaas-production-renewal-review.mjs';
import {sanitizeCrmAsaasEvent} from '../supabase/functions/_shared/crm-asaas-events.mjs';
const sale={
 id:'a187d10a-86c2-4304-b571-ef3a7d0f32d1',provider:'asaas',
 environment:'production',source:'site-captacao',billing_mode:'recurring',
 billing_cycle_months:1,sale_status:'provisioned',
 provisioned_at:'2026-10-01T18:00:00Z',organization_id:'org-one',
 product_id:'prod-crm',asaas_subscription_id:'sub_month123456',
 asaas_checkout_id:'123517639363',provider_customer_id:'cus_month123456',
 checkout_amount_cents:7900,registration_number:'12345678909',
};
const access={id:'access-one',organization_id:'org-one',product_id:'prod-crm',
 billing_provider:'asaas',billing_mode:'recurring',billing_cycle_months:1,
 commercial_condition:'standard',external_tenant_id:'tenant-real-uuid',
 subscription_status:'past_due',access_status:'suspended',
 provider_subscription_id:'sub_month123456',provider_customer_id:'cus_month123456',
 contracted_price_cents:7900,
};
const event=sanitizeCrmAsaasEvent({id:'evt_month123456789',event:'PAYMENT_RECEIVED',
 dateCreated:'2026-11-07 17:45:03',
 payment:{id:'pay_month123456',subscription:'sub_month123456',
  customer:'cus_month123456',paymentLink:'123517639363',dueDate:'2026-11-07',
  billingType:'PIX',status:'RECEIVED',value:79}});
const payment={id:'pay_month123456',customer:'cus_month123456',
 subscription:'sub_month123456',dueDate:'2026-11-07',status:'RECEIVED',
 billingType:'PIX',value:79};
const subscription={id:'sub_month123456',customer:'cus_month123456',
 status:'ACTIVE',nextDueDate:'2026-12-07',cycle:'MONTHLY',billingType:'PIX',
 value:79};
const customer={id:'cus_month123456',cpfCnpj:'12345678909'};
const link={id:'123517639363',externalReference:'nexus-crm-monthly-'+sale.id,
 chargeType:'RECURRENT',subscriptionCycle:'MONTHLY',billingType:'PIX',
 value:79};
async function run(overrides={}){
 const calls=[];
 const rows={
  '/payments/pay_month123456':overrides.payment??payment,
  '/subscriptions/sub_month123456':overrides.subscription??subscription,
  '/customers/cus_month123456':overrides.customer??customer,
  '/paymentLinks/123517639363':overrides.link??link,
 };
 const decision=await previewProductionCrmAsaasRenewal({
  eventRow:overrides.eventRow??event,sale:overrides.sale??sale,
  access:overrides.access??access,productCode:overrides.productCode??'crm',
  fetchResource:async path=>{calls.push(path);if(!(path in rows))throw Error('unexpected endpoint');return rows[path];},
 });
 return {decision,calls};
}
test('production renewal reviews four independent Asaas resources without activating access',async()=>{
 const {decision,calls}=await run();
 assert.equal(decision.decision,'verified_renewal_for_review');
 assert.equal(decision.readOnly,true);
 assert.equal(decision.canActivateCrm,false);
 assert.equal(decision.dueDate,'2026-11-07');
 assert.equal(decision.nextDueDate,'2026-12-07');
 assert.deepEqual(calls,['/payments/pay_month123456','/subscriptions/sub_month123456',
  '/customers/cus_month123456','/paymentLinks/123517639363']);
 assert.ok(!JSON.stringify(decision).includes('12345678909'));
});
test('cross-org, courtesy, cancelled, wrong product and sandbox return before Asaas calls',async()=>{
 for(const o of [
  {sale:{...sale,environment:'sandbox'}},
  {sale:{...sale,organization_id:'other'}},
  {sale:{...sale,sale_status:'checkout_created'}},
  {access:{...access,billing_provider:'stripe'}},
  {access:{...access,commercial_condition:'courtesy'}},
  {access:{...access,subscription_status:'cancelled'}},
  {access:{...access,external_tenant_id:null}},
  {productCode:'sst'},
  {eventRow:{...event,event_type:'PAYMENT_OVERDUE'}},
 ]){
  const {decision,calls}=await run(o);
  assert.notEqual(decision.decision,'verified_renewal_for_review');
  assert.deepEqual(calls,[],JSON.stringify(o));
 }
});
test('provider independently disproves another customer, value or monthly configuration',async()=>{
 for(const o of [
  {payment:{...payment,customer:'cus_foreign1234'}},
  {customer:{...customer,cpfCnpj:'11111111111'}},
  {subscription:{...subscription,cycle:'YEARLY'}},
  {subscription:{...subscription,status:'INACTIVE'}},
  {subscription:{...subscription,billingType:'BOLETO'}},
  {link:{...link,externalReference:'wrong'}},
  {link:{...link,chargeType:'DETACHED'}},
  {payment:{...payment,value:119}},
  {subscription:{...subscription,nextDueDate:'2026-10-07'}},
  {payment:{...payment,dueDate:'2026-11-08'}},
  {payment:{...payment,status:'OVERDUE'}},
 ]){
  const {decision}=await run(o);
  assert.notEqual(decision.decision,'verified_renewal_for_review',JSON.stringify(o));
  assert.equal(decision.canActivateCrm,false);
 }
});
test('read-only renewal module never calls network, SQL or CRM mutations',()=>{
 const code=readFileSync(new URL('../supabase/functions/_shared/crm-asaas-production-renewal-review.mjs',import.meta.url),'utf8');
 assert.doesNotMatch(code,/\bfetch\(|\bcreateClient\(|\.rpc\(|\.(?:insert|update|upsert|delete)\(/);
 assert.match(code,/readOnly:true,canActivateCrm:false/);
 assert.match(code,/return Object\.freeze\(\{\s*decision:'verified_renewal_for_review'/);
});
