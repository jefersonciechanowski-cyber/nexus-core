import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {previewCrmAsaasLifecycle} from '../supabase/functions/_shared/crm-asaas-lifecycle-preview.mjs';

const now='2026-10-30T13:00:00.000Z';
const sale={
  id:'a187d10a-86c2-4304-b571-ef3a7d0f32d1',
  provider:'asaas',environment:'sandbox',sale_status:'provisioned',
  product_id:'product-one',organization_id:'org-one',
  provisioned_at:'2026-10-29T16:00:00Z',registration_number:'12345678909',
  billing_mode:'recurring',billing_cycle_months:1,asaas_subscription_id:'sub_valid123',
  provider_customer_id:'cus_valid123',
};
const access={
  id:'access-one',organization_id:'org-one',product_id:'product-one',
  billing_provider:'asaas',billing_mode:'recurring',commercial_condition:'standard',
  external_tenant_id:'tenant-one',provider_subscription_id:'sub_valid123',
  provider_customer_id:'cus_valid123',contracted_price_cents:7900,
  subscription_status:'past_due',access_status:'suspended',
  provider_state_event_created_at:'2026-10-29T12:00:00.000Z',
  provider_state_event_id:'asaas:evt_previous123',
};
const receipt={
  provider:'asaas',provider_payment_id:'pay_valid123',
  provider_subscription_id:'sub_valid123',access_id:'access-one',organization_id:'org-one',
  currency:'BRL',amount_cents:7900,
};
const event=(type='PAYMENT_RECEIVED')=>({
  provider:'asaas',provider_event_id:'asaas:evt_lifecycle12345678',
  event_type:type,
  payload:{event:type,dateCreated:'2026-10-30T12:58:00.000Z',resource:{
    id:type.startsWith('SUBSCRIPTION_')?'sub_valid123':'pay_valid123',
    subscription:'sub_valid123',billingType:'BOLETO',value:79,
  }},
});
const pay={id:'pay_valid123',subscription:'sub_valid123',customer:'cus_valid123',value:79,status:'RECEIVED'};
const sub={id:'sub_valid123',customer:'cus_valid123',status:'ACTIVE'};
const customer={id:'cus_valid123',cpfCnpj:'12345678909'};
const mocks=({type='PAYMENT_RECEIVED',patch={},readOverrides={}}={})=>{
  const reads=[];
  const data={
    '/subscriptions/sub_valid123':sub,
    '/payments/pay_valid123':pay,
    '/customers/cus_valid123':customer,
    ...readOverrides,
  };
  const run=()=>previewCrmAsaasLifecycle({
    eventRow:patch.eventRow??event(type),
    sale:patch.sale??sale,access:patch.access??access,
    receipt:Object.hasOwn(patch,'receipt')?patch.receipt:receipt,
    productCode:patch.productCode??'crm',
    now:patch.now??now,
    fetchResource:async path=>{
      reads.push(path);
      if(!(path in data))throw Error('provider 404');
      if(data[path] instanceof Error)throw data[path];
      return data[path];
    },
  });
  return {reads,run};
};

test('recurrent payment: fresh Asaas GETs only propose reactivation; never grant CRM',async()=>{
  const {reads,run}=mocks();
  const result=await run();
  assert.deepEqual(result,{
    decision:'candidate',reason:'preview_only',readOnly:true,canActivateCrm:false,
    action:'reactivate',subscriptionStatus:'active',accessStatus:'active',
  });
  assert.deepEqual(reads,['/subscriptions/sub_valid123','/payments/pay_valid123','/customers/cus_valid123']);
});

test('refund independently checked at Asaas proposes suspension, never deletes tenant',async()=>{
  const {reads,run}=mocks({type:'PAYMENT_REFUNDED',readOverrides:{
    '/payments/pay_valid123':{...pay,status:'REFUNDED'},
  }});
  const result=await run();
  assert.equal(result.decision,'candidate');
  assert.equal(result.action,'suspend');
  assert.equal(result.accessStatus,'suspended');
  assert.equal(result.canActivateCrm,false);
  assert.equal(reads.length,3);
});

test('inactivated subscription may propose suspension without payment lookup',async()=>{
  const {reads,run}=mocks({type:'SUBSCRIPTION_INACTIVATED',readOverrides:{
    '/subscriptions/sub_valid123':{...sub,status:'INACTIVE'},
  }});
  const result=await run();
  assert.equal(result.action,'suspend');
  assert.equal(result.decision,'candidate');
  assert.deepEqual(reads,['/subscriptions/sub_valid123','/customers/cus_valid123']);
});

test('no automatic suspension for overdue, deleted subscription, chargeback or unknown events',async()=>{
  for(const [type,expected] of [
    ['PAYMENT_OVERDUE','await_explicit_grace_policy'],
    ['SUBSCRIPTION_DELETED','subscription_deletion_requires_independent_confirmation'],
    ['PAYMENT_CHARGEBACK_REQUESTED','chargeback_requires_manual_review'],
    ['SUBSCRIPTION_UPDATED','unsupported_transition'],
  ]){
    const {reads,run}=mocks({type});
    const result=await run();
    assert.equal(result.reason,expected);
    assert.equal(result.canActivateCrm,false);
    assert.deepEqual(reads,[]);
  }
});

test('repeated and stale events cannot re-enable access',async()=>{
  const repeated=mocks({patch:{access:{...access,provider_state_event_id:event().provider_event_id}}});
  assert.equal((await repeated.run()).reason,'duplicate');
  const stale=mocks({patch:{access:{...access,provider_state_event_created_at:'2026-10-30T12:59:00.000Z'}}});
  assert.equal((await stale.run()).reason,'stale_or_duplicate');
  assert.equal((await mocks({patch:{now:'2026-10-29T12:00:00.000Z'}}).run()).reason,'bad_event_time');
});

test('untrusted event, different tenant, product, provider or courtesy fails closed without provider reads',async()=>{
  for(const patch of [
    {eventRow:{...event(),payload:{...event().payload,event:'PAYMENT_REFUNDED'}}},
    {eventRow:{...event(),payload:{...event().payload,dateCreated:null}}},
    {sale:{...sale,environment:'production'}},
    {sale:{...sale,organization_id:'other'}},
    {sale:{...sale,sale_status:'checkout_created'}},
    {access:{...access,commercial_condition:'courtesy'}},
    {access:{...access,commercial_condition:'founder'}},
    {access:{...access,billing_provider:'stripe'}},
    {access:{...access,external_tenant_id:null}},
    {productCode:'sst'},
    {receipt:null},
    {receipt:{...receipt,organization_id:'other'}},
    {receipt:{...receipt,provider_payment_id:'pay_elsewhere'}},
    {receipt:{...receipt,currency:'USD'}},
    {receipt:{...receipt,amount_cents:11900}},
  ]){
    const {reads,run}=mocks({patch});
    const result=await run();
    assert.equal(result.canActivateCrm,false);
    assert.ok(['manual_review','hold'].includes(result.decision),JSON.stringify(result));
    assert.deepEqual(reads,[]);
  }
});

test('Asaas customer, CPF/CNPJ, payment amount, subscription owner and status must match',async()=>{
  for(const readOverrides of [
    {'/customers/cus_valid123':{...customer,cpfCnpj:'11111111111'}},
    {'/payments/pay_valid123':{...pay,value:119}},
    {'/payments/pay_valid123':{...pay,customer:'cus_other'}},
    {'/payments/pay_valid123':{...pay,subscription:'sub_other'}},
    {'/subscriptions/sub_valid123':{...sub,id:'sub_other'}},
  ]){
    const {run}=mocks({readOverrides});
    const outcome=await run();
    assert.equal(outcome.decision,'manual_review');
    assert.equal(outcome.canActivateCrm,false);
    assert.equal(JSON.stringify(outcome).includes('12345678909'),false);
  }
  const pending=mocks({readOverrides:{'/payments/pay_valid123':{...pay,status:'PENDING'}}});
  assert.equal((await pending.run()).reason,'paid_state_not_independently_verified');
});

test('provider outage never becomes a candidate and only exposes fixed reason',async()=>{
  const {run}=mocks({readOverrides:{'/subscriptions/sub_valid123':Error('secret provider response')}});
  assert.deepEqual(await run(),{
    decision:'retry',reason:'provider_lookup_failed',readOnly:true,canActivateCrm:false,
  });
});

test('endpoint is private, disabled by default, Sandbox-only and GET-only outside database',()=>{
  const src=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-lifecycle-preview/index.ts',import.meta.url),'utf8');
  assert.match(src,/NEXUS_CRM_ASAAS_LIFECYCLE_PREVIEW_ENABLED/);
  assert.match(src,/NEXUS_CRM_ASAAS_LIFECYCLE_PREVIEW_SECRET/);
  assert.match(src,/NEXUS_CRM_ASAAS_MONTHLY_MODE/);
  assert.match(src,/trustedAsaasToken/);
  assert.match(src,/api-sandbox\.asaas\.com\/v3/);
  assert.match(src,/method:'GET'/);
  assert.match(src,/\.eq\('provider_subscription_id',subscriptionId\)/);
  assert.match(src,/\.eq\('sale_status','provisioned'\)/);
  assert.match(src,/previewCrmAsaasLifecycle\(/);
  assert.doesNotMatch(src,/admin\.rpc\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(/);
  assert.doesNotMatch(src,/https:\/\/api\.asaas\.com\/v3/);
  assert.doesNotMatch(src,/provisionSaleForProvider\(|sendCrmAccessEmail\(/);
  const decision=readFileSync(new URL('../supabase/functions/_shared/crm-asaas-lifecycle-preview.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(decision,/fetch\(|\.rpc\(|\.insert\(|\.update\(|\.delete\(/);
});
