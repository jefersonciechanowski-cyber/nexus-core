import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {recordVerifiedCrmAsaasPayment} from '../supabase/functions/_shared/crm-asaas-payment-record.mjs';

const sale={id:'11111111-2222-4333-8444-555555555555',provider:'asaas',environment:'sandbox',
  sale_status:'paid',organization_id:'22222222-3333-4444-8555-666666666666',
  billing_mode:'recurring',billing_cycle_months:1,checkout_amount_cents:7900,
  asaas_subscription_id:'sub_valid123',external_reference:'nexus-crm-monthly-11111111'};
const access={id:'33333333-4444-4555-8666-777777777777',
  organization_id:sale.organization_id,billing_provider:'asaas',commercial_condition:'standard',
  subscription_status:'active'};
const payment={paymentId:'pay_valid123',subscriptionId:'sub_valid123',customerId:'cus_valid123',
  billingType:'PIX',status:'RECEIVED',amountCents:7900};
function createDb({claimDecision='provisioning',existing=null,insertFailure=false,claimError=false,
  wrongReceipt=false}={}){
  const state={payments:existing?[existing]:[],writes:[],reads:0};
  const claim={sale_id:sale.id,provider_payment_id:payment.paymentId,
    provider_subscription_id:payment.subscriptionId,amount_cents:7900,
    billing_type:'PIX',decision:claimDecision};
  const db={from(table){
    if(table==='nexus_crm_asaas_verified_payments'){
      return {select(){return {eq(){return {maybeSingle:async()=>({
        data:claimError?null:claim,error:claimError?{code:'failed'}:null})}}}}};
    }
    if(table==='nexus_payments'){
      return {
        select(){
          return {
            eq(_k,value){
              return {
                maybeSingle:async()=>{
                  state.reads++;
                  return {
                    data:state.payments.find(p=>p.provider_payment_id===value)||null,
                    error:null,
                  };
                },
              };
            },
          };
        },
        insert:async body=>{
          state.writes.push(body);
          if(insertFailure)return {error:{code:'23505'}};
          state.payments.push({
            id:'44444444-5555-4666-8777-888888888888',...body,
            ...(wrongReceipt?{organization_id:'wrong-org'}:{}),
          });
          return {error:null};
        },
      };
    }
    throw Error('Unexpected table '+table);
  }};
  return {db,state};
}
test('records precisely one Asaas payment for the verified CRM company before tenant',async()=>{
  const {db,state}=createDb();
  const r=await recordVerifiedCrmAsaasPayment({admin:db,sale,access,payment});
  assert.equal(r.ok,true);
  assert.equal(r.alreadyRecorded,false);
  assert.equal(state.writes.length,1);
  const saved=state.writes[0];
  assert.equal(saved.provider,'asaas');
  assert.equal(saved.organization_id,sale.organization_id);
  assert.equal(saved.access_id,access.id);
  assert.equal(saved.provider_payment_id,payment.paymentId);
  assert.equal(saved.provider_subscription_id,payment.subscriptionId);
  assert.equal(saved.amount_cents,7900);
  assert.equal(saved.provider_customer_id,payment.customerId);
  assert.equal(saved.billing_type,'PIX');
  assert.equal(saved.currency,'BRL');
});
test('same already recorded payment does not generate a duplicate',async()=>{
  const {db,state}=createDb();
  const first=await recordVerifiedCrmAsaasPayment({admin:db,sale,access,payment});
  const second=await recordVerifiedCrmAsaasPayment({admin:db,sale,access,payment});
  assert.equal(first.ok,true);
  assert.equal(second.ok,true);
  assert.equal(second.alreadyRecorded,true);
  assert.equal(state.writes.length,1);
});
test('amount, owner, event state, foreign provider and courtesy conflict fail closed',async()=>{
  for(const [salePatch,accessPatch,paymentPatch] of [
    [{environment:'production'},{},{}],[{sale_status:'checkout_created'},{},{}],
    [{asaas_subscription_id:'sub_other'},{},{}],
    [{},{commercial_condition:'courtesy'},{}],
    [{},{billing_provider:'stripe'},{}],
    [{organization_id:'other-org'},{},{}],
    [{},{},{amountCents:11900}],
    [{},{},{billingType:'CREDIT_CARD'}],
    [{},{},{status:'PENDING'}],
    [{},{},{customerId:'bad/customer'}],
  ]){
    const {db,state}=createDb();
    const r=await recordVerifiedCrmAsaasPayment({
      admin:db,sale:{...sale,...salePatch},access:{...access,...accessPatch},
      payment:{...payment,...paymentPatch},
    });
    assert.equal(r.ok,false,JSON.stringify({salePatch,accessPatch,paymentPatch}));
    assert.equal(state.writes.length,0);
  }
});
test('missing exclusive lease never records even a paid sale',async()=>{
  for(const claimDecision of ['provision_ready','verified_pending_provisioning','manual_review','provisioned']){
    const {db,state}=createDb({claimDecision});
    const r=await recordVerifiedCrmAsaasPayment({admin:db,sale,access,payment});
    assert.equal(r.ok,false);
    assert.equal(r.reason,'claim_not_provisioning');
    assert.equal(state.writes.length,0);
  }
});
test('foreign payment id or a DB outage causes manual review without mutation',async()=>{
  const old={id:'44444444-5555-4666-8777-888888888888',
    provider:'asaas',provider_payment_id:payment.paymentId,organization_id:'foreign_org',
    access_id:access.id,provider_subscription_id:payment.subscriptionId,
    provider_customer_id:payment.customerId,billing_type:'PIX',
    provider_status:'RECEIVED',amount_cents:7900,currency:'BRL'};
  const {db,state}=createDb({existing:old});
  const r=await recordVerifiedCrmAsaasPayment({admin:db,sale,access,payment});
  assert.equal(r.ok,false);assert.equal(r.reason,'provider_payment_claimed_elsewhere');
  assert.equal(state.writes.length,0);
  const outage=createDb({claimError:true});
  assert.equal((await recordVerifiedCrmAsaasPayment({admin:outage.db,sale,access,payment})).reason,'claim_lookup_failed');
});
test('database unique-index race is verified by re-read, never adopted from another company',async()=>{
  const {db,state}=createDb({insertFailure:true});
  const r=await recordVerifiedCrmAsaasPayment({admin:db,sale,access,payment});
  assert.equal(r.ok,false);
  assert.equal(r.reason,'payment_insert_or_conflict');
  assert.equal(state.writes.length,1);
});
test('inconsistent receipt read-back cannot activate the CRM',async()=>{
  const {db}=createDb({wrongReceipt:true});
  const r=await recordVerifiedCrmAsaasPayment({admin:db,sale,access,payment});
  assert.equal(r.ok,false);
  assert.equal(r.reason,'payment_receipt_not_confirmed');
});
test('shared Stripe provisioner uses receipt only in Asaas path and before tenant/email',()=>{
  const src=readFileSync(new URL('../supabase/functions/_shared/nexus-sale-provisioning.ts',import.meta.url),'utf8');
  const i=src.indexOf("const receipt = await recordVerifiedCrmAsaasPayment(");
  const j=src.indexOf("const crmProvision = await provisionCrmTenant(");
  const k=src.indexOf("sendCrmAccessEmail(");
  assert.ok(i>0&&j>i&&k>j);
  assert.match(src,/if \(provider === 'asaas'\) \{\s*\/\/ The Central's financial ledger/);
  assert.match(src,/sale_status:'manual_review'/);
  assert.match(src,/receipt\.reason/);
  assert.match(src,/!context\.paymentId/);
});
