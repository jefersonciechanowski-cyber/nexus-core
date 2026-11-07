import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reconcileProductionCrmAsaasSettlement} from '../supabase/functions/_shared/crm-asaas-production-settlement-pipeline.mjs';
import {recordVerifiedCrmAsaasPayment} from '../supabase/functions/_shared/crm-asaas-payment-record.mjs';

const prodWorker=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-production-provision/index.ts',import.meta.url),'utf8');
const sandboxWorker=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-provision/index.ts',import.meta.url),'utf8');
const shared=readFileSync(new URL('../supabase/functions/_shared/nexus-sale-provisioning.ts',import.meta.url),'utf8');
const ledger=readFileSync(new URL('../supabase/functions/_shared/crm-asaas-payment-record.mjs',import.meta.url),'utf8');

const proof={
 decision:'verified_for_review',canActivateCrm:false,
 eventId:'asaas:evt_productionproof1234',
 saleId:'11111111-2222-4333-8444-555555555555',
 paymentId:'pay_proof123456',subscriptionId:'sub_proof123456',
 amountCents:7900,billingType:'PIX',
};
async function pipeline({verified=proof,environment='production',reservationEnabled=true,claimEnabled=true,
  claimDecision='provision_ready', reserveDecision='reserved_for_review'}={}){
 const calls=[];
 const outcome=await reconcileProductionCrmAsaasSettlement({
   verification:verified,eventId:proof.eventId,environment,reservationEnabled,claimEnabled,
   callRpc:async(name,args)=>{
     calls.push({name,args});
     if(name==='reserve_nexus_crm_asaas_production_verified_payment'){
       return {data:{decision:reserveDecision,sale_id:proof.saleId,payment_id:proof.paymentId}};
     }
     if(name==='claim_nexus_crm_asaas_production_provisioning'){
       return {data:{decision:claimDecision,sale_id:proof.saleId,payment_id:proof.paymentId}};
     }
     throw Error('non-production financial rpc forbidden');
   },
 });
 return {outcome,calls};
}
test('verified production payment can become financial claim only via production RPCs',async()=>{
 const {outcome,calls}=await pipeline();
 assert.equal(outcome.decision,'ready_for_provisioning');
 assert.equal(outcome.canActivateCrm,false);
 assert.deepEqual(calls.map(x=>x.name),[
  'reserve_nexus_crm_asaas_production_verified_payment',
  'claim_nexus_crm_asaas_production_provisioning']);
});
test('no claim without independent proof, production environment or two staged approvals',async()=>{
 for(const scenario of [
  {environment:'sandbox'},
  {reservationEnabled:false},
  {claimEnabled:false},
  {verified:{...proof,decision:'manual_review'}},
  {verified:{...proof,canActivateCrm:true}},
  {verified:{...proof,amountCents:11900.5}},
  {verified:{...proof,subscriptionId:'sub_wrong/slash'}},
 ]){
  const {outcome,calls}=await pipeline(scenario);
  assert.notEqual(outcome.decision,'ready_for_provisioning');
  if(scenario.environment==='sandbox'||scenario.reservationEnabled===false||
    scenario.verified?.decision==='manual_review'||scenario.verified?.canActivateCrm===true){
     assert.equal(calls.length,0,JSON.stringify(scenario));
  }
 }
});
test('production worker is ALWAYS hard off before provider, finance and CRM side effects',()=>{
 const gate=prodWorker.indexOf('if (STAGED_ASAAS_PRODUCTION_PROVISION_DISABLED)');
 const db=prodWorker.indexOf("admin.from('nexus_crm_asaas_production_events')");
 const remote=prodWorker.indexOf("fetch('https://api.asaas.com/v3'+path");
 const provision=prodWorker.indexOf('provisionSaleForProvider(');
 assert.ok(gate>=0 && gate<db && db<remote && remote<provision);
 assert.match(prodWorker,/STAGED_ASAAS_PRODUCTION_PROVISION_DISABLED = true/);
 for(const flag of [
  'NEXUS_CRM_ASAAS_PROD_PROVISION_ENABLED','NEXUS_CRM_ASAAS_PROD_VERIFY_ENABLED',
  'NEXUS_CRM_ASAAS_PROD_RESERVATION_ENABLED','NEXUS_CRM_ASAAS_PROD_CLAIM_ENABLED',
  'NEXUS_CRM_ASAAS_PROD_SETTLEMENT_READY','NEXUS_CRM_ASAAS_PROD_WEBHOOK_CONFIRMED',
  'NEXUS_CRM_ASAAS_PROD_WORKER_SECRET',
 ]) assert.ok(prodWorker.includes(flag),flag);
 assert.match(prodWorker,/asaasEnvironment:'production'/);
 assert.match(prodWorker,/begin_nexus_crm_asaas_production_provisioning/);
 assert.match(prodWorker,/complete_nexus_crm_asaas_production_provisioning/);
 assert.match(prodWorker,/partial_provisioning_requires_manual_review/);
 assert.doesNotMatch(prodWorker,/api-sandbox|ASAAS_SANDBOX|NEXUS_CRM_ASAAS_MONTHLY_MODE/);
});
test('Sandbox worker keeps original token and endpoint, never uses production financial RPCs',()=>{
 assert.match(sandboxWorker,/STAGED_ASAAS_DISABLED = true/);
 assert.match(sandboxWorker,/NEXUS_CRM_ASAAS_MONTHLY_MODE/);
 assert.match(sandboxWorker,/api-sandbox\.asaas\.com\/v3/);
 assert.doesNotMatch(sandboxWorker,/asaasEnvironment:'production'|nexus_crm_asaas_production_events/);
});
test('explicit environment-scoped claim is required before real tenant/email',()=>{
 assert.match(shared,/asaasEnvironment='sandbox'/);
 assert.match(shared,/saleInput\?\.environment !== asaasEnvironment/);
 assert.match(shared,/nexus_crm_asaas_production_verified_payments/);
 assert.match(shared,/\.eq\('decision', 'provisioning'\)/);
 assert.ok(shared.indexOf(".eq('decision', 'provisioning')")<shared.indexOf('auth.admin.createUser'));
 assert.match(ledger,/environment='sandbox'/);
 assert.match(ledger,/sale\.environment!==environment/);
 assert.match(ledger,/nexus_crm_asaas_production_verified_payments/);
 const receipt=shared.indexOf('recordVerifiedCrmAsaasPayment(');
 const tenant=shared.indexOf('await provisionCrmTenant(');
 const email=shared.indexOf('await sendCrmAccessEmail(');
 assert.ok(receipt>0&&tenant>receipt&&email>tenant);
});
test('production ledger denies a sale without a reserved one-worker lease',async()=>{
 const sale={
   provider:'asaas',environment:'production',sale_status:'paid',billing_mode:'recurring',
   billing_cycle_months:1,id:'11111111-2222-4333-8444-555555555555',
   organization_id:'22222222-3333-4444-8555-666666666666',
   asaas_subscription_id:'sub_proof123456',checkout_amount_cents:7900,
 };
 const access={id:'33333333-4444-4555-8666-777777777777',
   organization_id:sale.organization_id,billing_provider:'asaas',
   commercial_condition:'standard',subscription_status:'active'};
 const payment={paymentId:'pay_proof123456',subscriptionId:'sub_proof123456',
  customerId:'cus_proof123456',billingType:'PIX',status:'RECEIVED',amountCents:7900};
 const tables=[];
 const db={from(table){
  tables.push(table);
  if(table==='nexus_crm_asaas_production_verified_payments')
   return {select(){return {eq(){return {maybeSingle:async()=>({
    data:{sale_id:sale.id,provider_subscription_id:payment.subscriptionId,
      amount_cents:7900,billing_type:'PIX',decision:'provision_ready'},error:null,
   })}}}}};
  throw Error('Unexpected ledger table '+table);
 }};
 const declined=await recordVerifiedCrmAsaasPayment({admin:db,sale,access,payment,environment:'production'});
 assert.equal(declined.ok,false);
 assert.equal(declined.reason,'claim_not_provisioning');
 assert.deepEqual(tables,['nexus_crm_asaas_production_verified_payments']);
 const defaultDenied=await recordVerifiedCrmAsaasPayment({admin:db,sale,access,payment});
 assert.equal(defaultDenied.ok,false);
 assert.equal(defaultDenied.reason,'unverified_or_unlinked_payment');
});
