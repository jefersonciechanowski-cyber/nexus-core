import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planCrmAsaasProductionDispatch} from '../supabase/functions/_shared/crm-asaas-production-dispatch-plan.mjs';

const source=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-production-dispatch/index.ts',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../.github/workflows/crm-asaas-production-dispatch.yml',import.meta.url),'utf8');
const inbox=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-production-events/index.ts',import.meta.url),'utf8');

const event={
  provider_event_id:'asaas:evt_sample12345',event_type:'PAYMENT_RECEIVED',
  environment:'production',processing_status:'pending',
  resource_id:'pay_sample12345',
  payload:{id:'evt_sample12345',event:'PAYMENT_RECEIVED',
    resource:{id:'pay_sample12345',subscription:'sub_sample12345',
      paymentLink:'plink_sample12345'}},
};
const sale={
  id:'sale-1',product_id:'crm-product-1',provider:'asaas',environment:'production',
  billing_mode:'recurring',billing_cycle_months:1,sale_status:'checkout_created',
  asaas_checkout_id:'plink_sample12345',asaas_subscription_id:null,paid_at:null,
};
const plan=(options={})=>planCrmAsaasProductionDispatch({
  eventRow:options.eventRow??event,sales:options.sales??[sale],
  productCode:options.productCode??'crm',
});

test('routes a new settled monthly sale only to the independent provisioner',()=>{
  for(const type of ['PAYMENT_RECEIVED','PAYMENT_CONFIRMED']){
    const e={...event,event_type:type,
      payload:{...event.payload,event:type}};
    const p=plan({eventRow:e});
    assert.equal(p.decision,'route_for_independent_verification');
    assert.equal(p.worker,'provision');
    assert.equal(p.independentlyVerified,false);
    assert.equal(p.canProvision,false);
    assert.equal(p.canCharge,false);
  }
});
test('routes provisioned subscriptions only to the renewal worker',()=>{
  const p=plan({sales:[{...sale,sale_status:'provisioned',
    asaas_subscription_id:'sub_sample12345'}]});
  assert.equal(p.decision,'route_for_independent_verification');
  assert.equal(p.worker,'renewal');
  assert.equal(p.canProvision,false);
});
test('cancelled subscriptions, refunds, late notifications and chargebacks never auto-process',()=>{
  for(const type of ['PAYMENT_OVERDUE','PAYMENT_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED',
    'SUBSCRIPTION_DELETED','SUBSCRIPTION_UPDATED','PAYMENT_FUTURE_NEW_EVENT']){
    const row={...event,event_type:type,payload:{...event.payload,event:type}};
    const out=plan({eventRow:row});
    assert.equal(out.decision,'manual_review',type);
    assert.equal(out.worker,null);
    assert.equal(out.canCharge,false);
  }
});
test('replays, sandbox, malformed envelope and already-processed events fail closed',()=>{
  for(const change of [
    {processing_status:'processed'}, {processing_status:'manual_review'},
    {environment:'sandbox'},
    {provider_event_id:'bad'},
    {resource_id:'pay_other12345'},
    {payload:{...event.payload,id:'evt_wrong12345'}},
    {payload:{...event.payload,event:'PAYMENT_OVERDUE'}},
  ]){
    const p=plan({eventRow:{...event,...change}});
    assert.notEqual(p.decision,'route_for_independent_verification');
    assert.equal(p.worker,null);
  }
});
test('no cross-company or ambiguous-sale routing, even when event mentions an existing link',()=>{
  const cases=[
    {sales:[]}, {sales:[sale,{...sale,id:'sale-2'}]},
    {productCode:'sst'},
    {sales:[{...sale,provider:'stripe'}]},
    {sales:[{...sale,environment:'sandbox'}]},
    {sales:[{...sale,billing_cycle_months:12}]},
    {sales:[{...sale,billing_mode:'prepaid'}]},
    {sales:[{...sale,sale_status:'cancelled'}]},
    {sales:[{...sale,sale_status:'paid',paid_at:null}]},
    {sales:[{...sale,asaas_checkout_id:'plink_different12345'}]},
    {sales:[{...sale,sale_status:'provisioned',asaas_subscription_id:null}]},
  ];
  for(const c of cases){
    const p=plan(c);
    assert.equal(p.decision,'manual_review',JSON.stringify(c));
    assert.equal(p.canProvision,false);
  }
});
test('dispatcher requires the exact GitHub OIDC workflow and release switches',()=>{
  assert.match(source,/createRemoteJWKSet/);
  assert.match(source,/jwtVerify\(token,jwks/);
  assert.match(source,/payload\.workflow_ref===WORKFLOW/);
  assert.match(source,/payload\.repository===REPO/);
  assert.match(source,/payload\.ref==='refs\/heads\/main'/);
  assert.match(source,/const PRODUCTION_FINANCIAL_DISPATCH_DISABLED = Deno.env.get\('NEXUS_CRM_ASAAS_PROD_RELEASE_APPROVED'\) !== 'true'/);
  assert.match(source,/NEXUS_CRM_ASAAS_PROD_DISPATCH_ENABLED/);
  assert.match(source,/NEXUS_CRM_ASAAS_PROD_SETTLEMENT_READY/);
  assert.match(source,/NEXUS_CRM_ASAAS_PROD_WEBHOOK_CONFIRMED/);
  assert.match(source,/if\(action==='dispatch'\)\{/);
  assert.match(source,/if\(PRODUCTION_FINANCIAL_DISPATCH_DISABLED/);
  assert.match(source,/const sourceEvent=await authorizedGithubJob\(request\)/);
  assert.match(source,/sourceEvent==='push' && action!=='inspect' && action!=='readiness'/);
  assert.match(source,/\['schedule','workflow_dispatch','push'\]/);
  assert.match(source,/eq\('processing_status','pending'\)/);
  assert.match(source,/MAX_EVENTS=3/);
});
test('worker calls are authenticated separately and only success can mark complete',()=>{
  assert.match(source,/NEXUS_CRM_ASAAS_PROD_WORKER_SECRET/);
  assert.match(source,/NEXUS_CRM_ASAAS_PROD_RENEWAL_SECRET/);
  assert.match(source,/x-nexus-central-internal-key/);
  assert.match(source,/x-nexus-crm-renewal-key/);
  assert.match(source,/ALLOWED_SUCCESS\[worker\]/);
  assert.match(source,/body\.crmSynced===true/);
  assert.match(source,/markEvent\(admin,event\.provider_event_id,'processed',null\)/);
  assert.match(source,/eq\('processing_status','pending'\)\.select\('provider_event_id'\)/);
  assert.match(source,/reason_code:reason/);
  assert.match(inbox,/await admin\.from\('nexus_crm_asaas_production_events'\)\.insert/);
  assert.match(inbox,/return respond\(\{received:true,duplicate:/);
});
test('scheduler keeps read-only diagnostics and allows billing dispatch only by explicit opt-in',()=>{
  assert.match(workflow,/audience=nexus-crm-asaas-production-dispatch/);
  assert.match(workflow,/id-token: write/);
  assert.match(workflow,/cancel-in-progress: false/);
  assert.ok(workflow.includes('push:\n    branches: [main]'));
  assert.ok(workflow.includes("paths:\n      - '.github/workflows/crm-asaas-production-dispatch.yml'"));
  assert.ok(workflow.includes("cron: '37 */6 * * *'"));
  assert.ok(workflow.includes("cron: '*/5 * * * *'"));
  assert.ok(workflow.includes("github.event.schedule == '37 */6 * * *'"));
  assert.match(workflow,/\{"action":"inspect"\}/);
  assert.match(workflow,/\{"action":"readiness"\}/);
  assert.match(workflow,/\{"action":"dispatch"\}/);
  const dispatch=workflow.slice(workflow.indexOf('name: Dispatch verified CRM Asaas events'));
  assert.ok(dispatch.startsWith('name: Dispatch verified CRM Asaas events'));
  assert.ok(dispatch.includes("vars.NEXUS_CRM_ASAAS_PROD_FINANCIAL_WORKFLOW_ENABLED == 'true'"));
  assert.ok(dispatch.includes("github.event_name != 'push'"));
  assert.ok(dispatch.includes("steps.oidc.outputs.token"));
  assert.ok(workflow.includes("if: ${{ github.event_name != 'schedule' || github.event.schedule == '37 */6 * * *' || vars.NEXUS_CRM_ASAAS_PROD_FINANCIAL_WORKFLOW_ENABLED == 'true' }}"));
  assert.doesNotMatch(workflow,/ASAAS_PRODUCTION_API_KEY|NEXUS_CRM_ASAAS_PROD_WORKER_SECRET/);
  assert.match(workflow,/financialDispatchEnabled/);
  assert.match(source,/PRODUCTION_FINANCIAL_DISPATCH_DISABLED = Deno.env.get\('NEXUS_CRM_ASAAS_PROD_RELEASE_APPROVED'\) !== 'true'/);
  assert.match(source,/sourceEvent==='push' && action!=='inspect' && action!=='readiness'/);
});
test('read-only queue inspection returns aggregate counts and never edits records',()=>{
  const inspect=source.slice(source.indexOf("if(action==='inspect'){"),
    source.indexOf('// This section cannot execute'));
  assert.match(inspect,/backlog\(admin\)/);
  assert.match(inspect,/readOnly:true/);
  assert.match(inspect,/financialDispatchEnabled:false/);
  assert.match(inspect,/providerDeliveryVerified:false/);
  assert.doesNotMatch(inspect,/\.update\(|\.insert\(|\.delete\(|callIndependentWorker\(/);
});

test('OIDC readiness uses only GET Asaas, reports missing flags by name and cannot grant access',()=>{
  assert.match(source,/async function preClientReadiness\(admin:any\)/);
  assert.match(source,/NEXUS_CRM_ASAAS_PROD_RELEASE_APPROVED/);
  assert.match(source,/NEXUS_CRM_ASAAS_PROD_CHECKOUT_BRIDGE_SECRET/);
  assert.match(source,/NEXUS_CRM_ASAAS_PROD_WORKER_SECRET/);
  assert.match(source,/NEXUS_CRM_ASAAS_PROD_RENEWAL_SECRET/);
  assert.match(source,/NEXUS_CRM_ASAAS_PROD_EVENTS_TOKEN/);
  assert.match(source,/readyToReceiveFirstCustomer:/);
  assert.match(source,/providerDeliveryVerified:false/);
  assert.match(source,/fetch\('https:\/\/api\.asaas\.com\/v3\/webhooks\?limit=100'/);
  assert.match(source,/method:'GET'/);
  const readiness=source.slice(source.indexOf('async function preClientReadiness'),
    source.indexOf('Deno.serve(async(request:Request)=>'));
  assert.doesNotMatch(readiness,/method:\s*'POST'|\.update\(|\.insert\(|\.delete\(|admin\.rpc\(/);
  assert.doesNotMatch(readiness,/return.*(secret|asaasKey|service)/i);
  assert.match(workflow,/name: Check first-customer release readiness without charges/);
  assert.match(workflow,/d\.get\("createdCharge"\) is False/);
});

test('production bridge parity never creates a charge and keeps unavailable/mismatch closed',()=>{
  assert.match(source,/async function crmAsaasBridgeProofStatus\(\):Promise<string>/);
  assert.match(source,/https:\/\/crm\.nexuscore\.app\.br\/api\/internal\/crm-asaas-bridge-proof/);
  assert.match(source,/method:'GET',redirect:'error'/);
  assert.match(source,/NEXUS_CRM_ASAAS_READONLY_BRIDGE_KEY_PROOF_V1/);
  assert.match(source,/return difference===0\?'matched':'mismatch'/);
  assert.match(source,/bridgeStatus==='matched'/);
  const proof=source.slice(source.indexOf('async function crmAsaasBridgeProofStatus'),
    source.indexOf('async function preClientReadiness'));
  assert.doesNotMatch(proof,/\.insert\(|\.update\(|\.delete\(|\.rpc\(|method:'POST'/);
  assert.doesNotMatch(proof,/return.*\bsecret\b|return.*\bdigest\b|return.*\bexpected\b/);
  assert.match(workflow,/bridge=%s/);
  assert.doesNotMatch(workflow,/PROOF_INPUT|bridgeSecret|\.proof/);
});

test('authenticated webhook receiver health check is read-only and does not forge an Asaas delivery',()=>{
 assert.match(source,/async function checkInternalWebhookReceiver\(\):Promise<string>/);
 assert.match(source,/x-nexus-crm-webhook-check/);
 assert.match(source,/asaas-access-token/);
 assert.match(source,/method:'GET',redirect:'error'/);
 assert.match(source,/parsed\?\.status==='internal_token_and_inbox_ok'/);
 assert.match(source,/parsed\?\.providerDeliveryVerified===false/);
 assert.match(source,/receiverProbeStatus==='internal_token_and_inbox_ok'/);
 const probe=source.slice(source.indexOf('async function checkInternalWebhookReceiver'),
   source.indexOf('async function preClientReadiness'));
 assert.doesNotMatch(probe,/method:\s*'POST'|\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
 assert.doesNotMatch(probe,/return.*\btoken\b|console\.log|console\.error/);
 assert.match(workflow,/receiver=%s/);
});
