import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTrialUpgrade,eligibleTrialUpgrade,buildTrialUpgradeLink,verifyTrialUpgradePayment,safeUpgradeUrl} from '../supabase/functions/_shared/crm-trial-upgrade.mjs';
import {planCrmAsaasProductionDispatch} from '../supabase/functions/_shared/crm-asaas-production-dispatch-plan.mjs';
const org='30000000-0000-4000-8000-000000000011',tenant='60000000-0000-4000-8000-000000000011';
const sale={id:'50000000-0000-4000-8000-000000000011',organization_id:org,product_id:'crm-product',plan_id:'pro-plan',source:'crm-trial-upgrade',provider:'asaas',environment:'production',sale_status:'checkout_created',billing_mode:'recurring',billing_cycle_months:1,checkout_amount_cents:11900,asaas_checkout_id:'plink_upgrade01',registration_number:'52998224725'};
const plan={id:'pro-plan',product_id:'crm-product',code:'pro',name:'Pro',status:'active',currency:'BRL',public_visible:true,billing_interval_months:1,price_cents:11900};
const event={provider:'asaas',environment:'production',processing_status:'pending',event_type:'PAYMENT_RECEIVED',provider_event_id:'asaas:evt_upgrade01',resource_id:'pay_upgrade01',payload:{id:'evt_upgrade01',event:'PAYMENT_RECEIVED',resource:{id:'pay_upgrade01',paymentLink:sale.asaas_checkout_id,subscription:'sub_upgrade01'}}};
const resources={
 '/payments/pay_upgrade01':{id:'pay_upgrade01',status:'RECEIVED',dueDate:'2026-11-10',paymentLink:sale.asaas_checkout_id,subscription:'sub_upgrade01',customer:'cus_upgrade01',value:119,billingType:'PIX'},
 '/paymentLinks/plink_upgrade01':{id:'plink_upgrade01',active:false,limit:1,chargeType:'RECURRENT',subscriptionCycle:'MONTHLY',externalReference:'nexus-crm-trial-upgrade-'+sale.id,billingType:'PIX',value:119},
 '/subscriptions/sub_upgrade01':{id:'sub_upgrade01',paymentLink:'plink_upgrade01',customer:'cus_upgrade01',cycle:'MONTHLY',nextDueDate:'2026-12-10',status:'ACTIVE',billingType:'PIX',value:119},
 '/customers/cus_upgrade01':{id:'cus_upgrade01',cpfCnpj:sale.registration_number},
};
const run=(overrides={})=>verifyTrialUpgradePayment({event,sale,plan,fetchResource:async p=>structuredClone(resources[p]),...overrides});
test('fresh RECEIVED receipt on a consumed one-use link is independently verified',async()=>{
 assert.equal((await run()).decision,'verified');
 for(const method of ['PIX','BOLETO']){const r=structuredClone(resources);for(const value of Object.values(r))if(value.billingType)value.billingType=method;
  assert.equal((await run({fetchResource:async p=>r[p]})).billingType,method);}
});
test('confirmed, refunded, forged amount, another tenant and unrelated provider data cannot activate',async()=>{
 for(const [path,patch] of [
  ['/payments/pay_upgrade01',{status:'CONFIRMED'}],['/payments/pay_upgrade01',{status:'REFUNDED'}],
  ['/payments/pay_upgrade01',{value:79}],['/subscriptions/sub_upgrade01',{customer:'cus_another01'}],
  ['/paymentLinks/plink_upgrade01',{externalReference:'other-sale'}],['/paymentLinks/plink_upgrade01',{limit:null}],
  ['/customers/cus_upgrade01',{cpfCnpj:'11111111111'}],['/subscriptions/sub_upgrade01',{cycle:'YEARLY'}]]){
  const r=structuredClone(resources);Object.assign(r[path],patch);
  assert.notEqual((await run({fetchResource:async p=>r[p]})).decision,'verified');
 }
 assert.equal((await run({fetchResource:async()=>{throw Error('offline');}})).decision,'retry');
 assert.notEqual((await run({sale:{...sale,source:'site-captacao'}})).decision,'verified');
});
test('upgrade never routes to new-tenant provisioner; subsequent invoice routes to renewal',()=>{
 assert.equal(planCrmAsaasProductionDispatch({eventRow:event,sales:[sale],productCode:'crm'}).worker,'upgrade');
 assert.equal(planCrmAsaasProductionDispatch({eventRow:event,sales:[{...sale,sale_status:'paid'}],productCode:'crm'}).worker,'upgrade');
 assert.equal(planCrmAsaasProductionDispatch({eventRow:event,sales:[{...sale,sale_status:'provisioned',asaas_subscription_id:'sub_upgrade01'}],productCode:'crm'}).worker,'renewal');
});
test('checkout uses server price and one subscription; rejects untrusted URLs',()=>{
 const link=buildTrialUpgradeLink({plan,method:'PIX',saleId:sale.id});
 assert.equal(link.value,119);assert.equal(link.limit,1);assert.equal(link.chargeType,'RECURRENT');
 assert.equal(link.externalReference,'nexus-crm-trial-upgrade-'+sale.id);
 for(const u of ['https://asaas.com.evil.test/p','https://asaas.com@evil.test/p','http://asaas.com/p','https://sandbox.asaas.com/p'])assert.equal(safeUpgradeUrl(u),null);
});
test('only original verified owner of active or expired standard trial can upgrade',()=>{
 const input=normalizeTrialUpgrade({action:'crm-trial-paid-upgrade-v1',crmOrganizationId:tenant,actorUserId:org,actorEmail:'owner@example.test',planCode:'pro',paymentMethod:'PIX',acceptedTerms:true});
 const organization={id:org,status:'active',email:'owner@example.test'};
 const access={id:'access',organization_id:org,product_id:plan.product_id,external_tenant_id:tenant,commercial_condition:'standard',contracted_price_cents:0,billing_provider:null,provider_subscription_id:null,subscription_status:'trial',access_status:'active'};
 const claim={access_id:'access',organization_id:org,state:'provisioned',trial_days:15};
 const context={input,organization,access,claim,plan};assert.equal(eligibleTrialUpgrade(context),true);
 assert.equal(eligibleTrialUpgrade({...context,access:{...access,subscription_status:'past_due',access_status:'suspended',last_payment_status:'trial_expired'}}),true);
 for(const patch of [{commercial_condition:'courtesy'},{billing_provider:'stripe'},{external_tenant_id:org},{subscription_status:'active'},{contracted_price_cents:11900}])assert.equal(eligibleTrialUpgrade({...context,access:{...access,...patch}}),false);
 assert.equal(eligibleTrialUpgrade({...context,input:{...input,actorEmail:'other@example.test'}}),false);
});
