import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {reconcileCrmAsaasSettlement} from '../supabase/functions/_shared/crm-asaas-settlement-pipeline.mjs';
import {verifyCrmAsaasPayment} from '../supabase/functions/_shared/crm-asaas-provider-verification.mjs';

const saleId='a187d10a-86c2-4304-b571-ef3a7d0f32d1';
const eventId='asaas:evt_abcde123456789';
const verification={decision:'verified_for_review',canActivateCrm:false,
  eventId,saleId,paymentId:'pay_abc12345',subscriptionId:'sub_abc12345',
  amountCents:7900,billingType:'PIX'};
const make=({reservationEnabled=true,claimEnabled=false,environment='sandbox',verified=verification,
  reserveReturn={decision:'reserved_for_review',sale_id:saleId,payment_id:verification.paymentId},
  claimReturn={decision:'provision_ready',sale_id:saleId}}={})=>{
  const calls=[];
  const rpc=async(name,args)=>{
    calls.push({name,args});
    return {data:name==='reserve_nexus_crm_asaas_verified_payment'?reserveReturn:claimReturn,error:null};
  };
  return {calls,run:()=>reconcileCrmAsaasSettlement({
    verification:verified,eventId,environment,reservationEnabled,claimEnabled,callRpc:rpc,
  })};
};
test('flags OFF: no database calls, no access released',async()=>{
  const s=make({reservationEnabled:false,claimEnabled:false});
  const result=await s.run();
  assert.equal(result.decision,'verified_for_review');
  assert.equal(result.canActivateCrm,false);
  assert.equal(s.calls.length,0);
});
test('reservation does not automatically claim or grant CRM',async()=>{
  const s=make();
  const result=await s.run();
  assert.equal(result.decision,'reserved_for_review');
  assert.equal(result.canActivateCrm,false);
  assert.deepEqual(s.calls.map(x=>x.name),['reserve_nexus_crm_asaas_verified_payment']);
  assert.deepEqual(s.calls[0].args,{
    p_sale_id:saleId,p_provider_event_id:eventId,p_provider_payment_id:'pay_abc12345',
    p_provider_subscription_id:'sub_abc12345',p_amount_cents:7900,p_billing_type:'PIX',
  });
});
test('separate financial flag requires BOTH successful reserve and claim',async()=>{
  const s=make({claimEnabled:true});
  const result=await s.run();
  assert.equal(result.decision,'ready_for_provisioning');
  assert.equal(result.canActivateCrm,false);
  assert.deepEqual(s.calls.map(x=>x.name),
    ['reserve_nexus_crm_asaas_verified_payment','claim_nexus_crm_asaas_provisioning']);
});
test('repeat verified payment is treated as a non-granting idempotent financial claim',async()=>{
  const s=make({claimEnabled:true,claimReturn:{decision:'already_claimed',sale_id:saleId}});
  const result=await s.run();
  assert.equal(result.decision,'ready_for_provisioning');
  assert.equal(result.reason,'already_claimed');
  assert.equal(result.canActivateCrm,false);
});
test('wrong sale/event/payment IDs and forged verified decision fail before any DB call',async()=>{
  for(const changed of [
    {saleId:'not_uuid'},{eventId:'asaas:evt_wrong'},
    {amountCents:0},{amountCents:119.5},{billingType:'CREDIT_CARD'},
    {subscriptionId:'sub_/bad'},{paymentId:'pay_?'},{canActivateCrm:true},
    {decision:'manual_review'},
  ]){
    const s=make({claimEnabled:true,verified:{...verification,...changed}});
    const result=await s.run();
    assert.equal(result.decision,'manual_review');
    assert.equal(result.canActivateCrm,false);
    assert.equal(s.calls.length,0);
  }
});
test('production mode never makes calls even if all feature flags enabled',async()=>{
  const s=make({claimEnabled:true,environment:'production'});
  assert.equal((await s.run()).reason,'sandbox_only');
  assert.equal(s.calls.length,0);
});
test('reservation error, RPC outage or mismatched reservation blocks financial claim',async()=>{
  for(const reserveReturn of [
    {decision:'manual_review',reason:'wrong_identity'},
    {decision:'reserved_for_review',sale_id:'another_sale',payment_id:'pay_abc12345'},
    {decision:'reserved_for_review',sale_id:saleId,payment_id:'pay_other'},
  ]){
    const s=make({claimEnabled:true,reserveReturn});
    assert.equal((await s.run()).decision,'manual_review');
    assert.equal(s.calls.length,1);
  }
  const error=await reconcileCrmAsaasSettlement({verification,eventId,environment:'sandbox',
    reservationEnabled:true,claimEnabled:true,callRpc:async()=>{throw Error('fake timeout')}});
  assert.equal(error.decision,'retry');
  assert.equal(error.canActivateCrm,false);
});
test('claim rejects conflicting sale and any other decision; no access',async()=>{
  for(const claimReturn of [
    {decision:'manual_review',reason:'company_exists'},
    {decision:'provision_ready',sale_id:'another_sale'},
    null
  ]){
    const s=make({claimEnabled:true,claimReturn});
    const result=await s.run();
    assert.equal(result.decision,'manual_review');
    assert.equal(result.canActivateCrm,false);
  }
});
test('endpoint only calls pipeline under private sandbox authentication, no grant',()=>{
  const s=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-verify-event/index.ts',import.meta.url),'utf8');
  assert.match(s,/trustedAsaasToken\(/);
  assert.match(s,/NEXUS_CRM_ASAAS_VERIFY_ENABLED/);
  assert.match(s,/NEXUS_CRM_ASAAS_MONTHLY_MODE/);
  assert.match(s,/reservationEnabled:false/);
  assert.match(s,/claimEnabled:false/);
  assert.match(s,/verifyCrmAsaasPayment\(/);
  assert.match(s,/reconcileCrmAsaasSettlement\(/);
  assert.doesNotMatch(s,/provisionSaleForProvider\(|sendCrmAccessEmail\(/);
});

test('offline provider-to-ledger integration: four Asaas reads -> reserve -> claim, without CRM access',async()=>{
  const sale={
    id:saleId,provider:'asaas',environment:'sandbox',sale_status:'checkout_created',
    billing_mode:'recurring',billing_cycle_months:1,
    asaas_checkout_id:'plink_public123',registration_number:'12345678909',
    checkout_amount_cents:7900,asaas_subscription_id:null,
  };
  const resource={
    id:'pay_abc12345',paymentLink:'plink_public123',
    subscription:'sub_abc12345',customer:'cus_abc12345',
    billingType:'PIX',status:'RECEIVED',value:79,
  };
  const provider=new Map([
    ['/payments/pay_abc12345',resource],
    ['/paymentLinks/plink_public123',{
      id:'plink_public123',externalReference:'nexus-crm-monthly-'+saleId,
      chargeType:'RECURRENT',subscriptionCycle:'MONTHLY',billingType:'PIX',value:79,
    }],
    ['/customers/cus_abc12345',{id:'cus_abc12345',cpfCnpj:'12345678909'}],
    ['/subscriptions/sub_abc12345',{
      id:'sub_abc12345',customer:'cus_abc12345',cycle:'MONTHLY',
      billingType:'PIX',value:79,
    }],
  ]);
  const actualPaths=[];
  const checked=await verifyCrmAsaasPayment({
    eventRow:{provider_event_id:eventId,provider:'asaas',event_type:'PAYMENT_RECEIVED',
      payload:{event:'PAYMENT_RECEIVED',resource}},
    sale,
    fetchResource:async path=>{
      actualPaths.push(path);
      if(!provider.has(path))throw Error('Unexpected provider API path');
      return provider.get(path);
    },
  });
  assert.equal(checked.decision,'verified_for_review');
  assert.equal(checked.canActivateCrm,false);
  assert.equal(actualPaths.length,4);
  const captured=[];
  const result=await reconcileCrmAsaasSettlement({
    verification:checked,eventId,environment:'sandbox',
    reservationEnabled:true,claimEnabled:true,
    callRpc:async(name,args)=>{
      captured.push({name,args});
      if(name==='reserve_nexus_crm_asaas_verified_payment'){
        return {data:{decision:'reserved_for_review',sale_id:saleId,payment_id:checked.paymentId},error:null};
      }
      if(name==='claim_nexus_crm_asaas_provisioning'){
        return {data:{decision:'provision_ready',sale_id:saleId},error:null};
      }
      throw Error('Forbidden RPC');
    },
  });
  assert.equal(result.decision,'ready_for_provisioning');
  assert.equal(result.canActivateCrm,false);
  assert.deepEqual(captured.map(x=>x.name),[
    'reserve_nexus_crm_asaas_verified_payment','claim_nexus_crm_asaas_provisioning']);
  assert.equal(captured[0].args.p_amount_cents,7900);
  assert.equal(captured[0].args.p_billing_type,'PIX');
});

test('disabled financial reservation cannot disguise a rejected provider event as verified',async()=>{
  const calls=[];
  const result=await reconcileCrmAsaasSettlement({
    verification:{decision:'manual_review',reason:'customer_document_mismatch',canActivateCrm:false},
    eventId,environment:'sandbox',reservationEnabled:false,claimEnabled:false,
    callRpc:async()=>{calls.push(1);throw Error('unexpected financial call');},
  });
  assert.equal(result.decision,'manual_review');
  assert.equal(result.reason,'verification_not_authorized');
  assert.equal(result.canActivateCrm,false);
  assert.deepEqual(calls,[]);
});
