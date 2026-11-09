import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {verifyProductionCrmAsaasAnnual} from '../supabase/functions/_shared/crm-asaas-annual-verification.mjs';
import {planCrmAsaasProductionDispatch} from '../supabase/functions/_shared/crm-asaas-production-dispatch-plan.mjs';

const saleId='06c318ec-1fc6-40e0-9365-e11b93a5225e',plink='plink_fake123456',paymentId='pay_1234567890';
const plan={id:'e9dd6e2e-8baf-4b92-af6b-f3ac532ac216',code:'pro',name:'Pro',
  product_id:'1ef23543-63ef-4b36-a9fb-f3e269eaa907',status:'active',
  public_visible:true,currency:'BRL',billing_interval_months:1,price_cents:11900};
const sale={id:saleId,plan_id:plan.id,product_id:plan.product_id,
  provider:'asaas',environment:'production',source:'site-captacao',
  sale_status:'checkout_created',billing_mode:'prepaid',billing_cycle_months:12,
  asaas_checkout_id:plink,asaas_subscription_id:null,checkout_amount_cents:119000,
  organization_id:null,user_id:null,registration_number:'12345678909'};
const event={provider_event_id:'asaas:evt_1234567890',provider:'asaas',
  environment:'production',event_type:'PAYMENT_RECEIVED',resource_id:paymentId,
  processing_status:'pending',payload:{id:'evt_1234567890',event:'PAYMENT_RECEIVED',
    resource:{id:paymentId,paymentLink:plink,subscription:null}}};
const resources={
  ['/payments/'+paymentId]:{id:paymentId,paymentLink:plink,subscription:null,
    customer:'cus_1234567890',value:1190,billingType:'PIX',status:'RECEIVED'},
  ['/paymentLinks/'+plink]:{id:plink,chargeType:'DETACHED',
    billingType:'PIX',value:1190,externalReference:'nexus-crm-bf-annual-'+saleId},
  '/customers/cus_1234567890':{id:'cus_1234567890',cpfCnpj:'12345678909'},
};
const run=(data={})=>verifyProductionCrmAsaasAnnual({
  eventRow:data.event||event,sale:data.sale||sale,plan:data.plan||plan,
  fetchResource:async path => data.resources?.[path]||resources[path],
});
test('annual verifies one detached provider payment; does not trust webhook as proof',async()=>{
  const result=await run();
  assert.equal(result.decision,'verified_for_settlement');
  assert.equal(result.amountCents,119000);
  assert.equal(result.billingCycleMonths,12);
  assert.equal(result.canActivateCrm,false);
  assert.equal(result.paymentId,paymentId);
  assert.equal(result.customerId,'cus_1234567890');
  const confirmed={...resources,['/payments/'+paymentId]:{...resources['/payments/'+paymentId],status:'CONFIRMED'}};
  assert.equal((await run({resources:confirmed})).decision,'retry');
  const outbound=await run({event:{...event,event_type:'PAYMENT_REFUNDED'}});
  assert.notEqual(outbound.decision,'verified_for_settlement');
});
test('forged price, document, provider link, subscription and plan fail closed',async()=>{
  for(const [path,change] of [
    ['/payments/'+paymentId,{value:119}],
    ['/payments/'+paymentId,{subscription:'sub_anything'}],
    ['/paymentLinks/'+plink,{chargeType:'RECURRENT'}],
    ['/paymentLinks/'+plink,{value:2000}],
    ['/paymentLinks/'+plink,{externalReference:'other'}],
    ['/customers/cus_1234567890',{cpfCnpj:'12345678908'}],
  ]){
    const bad={...resources,[path]:{...resources[path],...change}};
    assert.notEqual((await run({resources:bad})).decision,'verified_for_settlement',path);
  }
  assert.notEqual((await run({sale:{...sale,billing_cycle_months:1}})).decision,'verified_for_settlement');
  assert.notEqual((await run({sale:{...sale,checkout_amount_cents:11900}})).decision,'verified_for_settlement');
  assert.notEqual((await run({plan:{...plan,price_cents:12900}})).decision,'verified_for_settlement');
});
test('only annual first sale routes to annual worker, never monthly or renewals',()=>{
  assert.equal(planCrmAsaasProductionDispatch({eventRow:event,sales:[sale],productCode:'crm'}).worker,'annual');
  assert.equal(planCrmAsaasProductionDispatch({
    eventRow:event,sales:[{...sale,sale_status:'provisioned'}],productCode:'crm'
  }).decision,'manual_review');
  assert.equal(planCrmAsaasProductionDispatch({
    eventRow:event,sales:[{...sale,billing_mode:'prepaid',billing_cycle_months:1}],productCode:'crm'
  }).decision,'manual_review');
  const monthly={...sale,billing_mode:'recurring',billing_cycle_months:1,
    asaas_subscription_id:'sub_1234567890'};
  assert.equal(planCrmAsaasProductionDispatch({eventRow:event,sales:[monthly],productCode:'crm'}).worker,'provision');
});
test('SQL annual ledger uses real DB leases, RLS and service-role only',()=>{
  const sql=readFileSync(new URL('../supabase/migrations/20261108233500_crm_asaas_annual_settlement_ledger.sql',import.meta.url),'utf8');
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/REVOKE ALL ON TABLE/);
  assert.match(sql,/TO service_role/);
  assert.match(sql,/UNIQUE NOT NULL/);
  assert.match(sql,/FOR UPDATE/);
  assert.match(sql,/sale_status='paid'/);
  assert.match(sql,/provider_subscription_id IS NULL/);
  assert.match(sql,/billing_cycle_months=12/);
  assert.match(sql,/nexus_payments/);
});
test('annual worker requires independent flags and does not reuse monthly provision code',()=>{
  const worker=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-production-annual-provision/index.ts',import.meta.url),'utf8');
  const annualSale=readFileSync(new URL('../supabase/functions/_shared/crm-asaas-annual-sale-provisioning.ts',import.meta.url),'utf8');
  assert.match(worker,/NEXUS_CRM_ASAAS_PROD_ANNUAL_RELEASE_APPROVED/);
  assert.match(worker,/NEXUS_CRM_ASAAS_PROD_ANNUAL_SETTLEMENT_READY/);
  assert.match(worker,/NEXUS_CRM_ASAAS_PROD_ANNUAL_WORKER_READY/);
  assert.match(worker,/trustedAsaasToken/);
  assert.match(worker,/verifyProductionCrmAsaasAnnual/);
  assert.match(worker,/begin_nexus_crm_asaas_production_annual_provisioning/);
  assert.match(worker,/complete_nexus_crm_asaas_production_annual_provisioning/);
  assert.match(annualSale,/nexus_crm_asaas_production_annual_settlements/);
  assert.match(annualSale,/recordVerifiedCrmAsaasAnnualPayment/);
  assert.match(annualSale,/subscriptionId != null/);
  assert.match(annualSale,/billing_mode !== 'prepaid'/);
  assert.match(annualSale,/source !== 'site-captacao'/);
});

test('annual expiry job is scheduled, OIDC-protected and gated by backend release',()=>{
  const yaml=readFileSync(new URL('../.github/workflows/crm-asaas-annual-expiry.yml',import.meta.url),'utf8');
  assert.match(yaml,/schedule:/);
  assert.match(yaml,/NEXUS_CRM_ASAAS_PROD_ANNUAL_EXPIRY_WORKFLOW_ENABLED != 'false'/);
  assert.match(yaml,/audience=nexus-crm-asaas-annual-expiry/);
  assert.match(yaml,/id-token: write/);
  assert.ok(yaml.includes("http == '503' && data.get('error') == 'Expiração anual em homologação.'"));
  assert.match(yaml,/http == '200'/);
  assert.match(yaml,/data\['suspended'\] == data\['synced'\]/);
  assert.doesNotMatch(yaml,/secrets\.|ASAAS_PRODUCTION_API_KEY|STRIPE_SECRET/);
});
