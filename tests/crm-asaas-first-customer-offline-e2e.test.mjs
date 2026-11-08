import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCrmAsaasRecurringLink} from '../supabase/functions/_shared/crm-asaas-monthly-contract.mjs';
import {sanitizeCrmAsaasEvent} from '../supabase/functions/_shared/crm-asaas-events.mjs';
import {planCrmAsaasProductionDispatch} from '../supabase/functions/_shared/crm-asaas-production-dispatch-plan.mjs';
import {previewProductionCrmAsaasPayment} from '../supabase/functions/_shared/crm-asaas-production-review.mjs';
import {reconcileProductionCrmAsaasSettlement} from '../supabase/functions/_shared/crm-asaas-production-settlement-pipeline.mjs';
import {previewProductionCrmAsaasRenewal} from '../supabase/functions/_shared/crm-asaas-production-renewal-review.mjs';

// Offline fixture. No network, accounts, emails, production rows or charges.
const saleId='a187d10a-86c2-4304-b571-ef3a7d0f32d1';
const linkId='123517639363';
const subId='sub_month123456';
const customerId='cus_month123456';
const paymentId='pay_first123456';
const plan={code:'start',name:'Start',price_cents:7900,status:'active',
  public_visible:true,currency:'BRL',billing_interval_months:1};
const sale={
  id:saleId,product_id:'prod-crm',provider:'asaas',environment:'production',
  source:'site-captacao',billing_mode:'recurring',billing_cycle_months:1,
  sale_status:'checkout_created',paid_at:null,asaas_checkout_id:linkId,
  asaas_subscription_id:null,checkout_amount_cents:7900,
  registration_number:'12345678909',
};
const payment={id:paymentId,paymentLink:linkId,subscription:subId,
  customer:customerId,billingType:'PIX',value:79,status:'RECEIVED',
  dueDate:'2026-11-08'};
const link={id:linkId,externalReference:'nexus-crm-monthly-'+saleId,
  chargeType:'RECURRENT',subscriptionCycle:'MONTHLY',billingType:'PIX',value:79};
const customer={id:customerId,cpfCnpj:'12345678909'};
const subscription={id:subId,customer:customerId,cycle:'MONTHLY',
  billingType:'PIX',value:79,status:'ACTIVE',nextDueDate:'2026-12-08'};
function sourceEvent(paymentData=payment,eventId='evt_firstpayment123456'){
  return sanitizeCrmAsaasEvent({
    id:eventId,event:'PAYMENT_RECEIVED',dateCreated:'2026-11-08 10:00:00',
    payment:paymentData,
  });
}
function getter(rows,calls){
  return async path=>{
    calls.push('GET '+path);
    assert.ok(Object.hasOwn(rows,path),'unapproved provider lookup: '+path);
    return rows[path];
  };
}
test('no-client first-month simulation: plan -> webhook -> four GETs -> reservation -> claim',async()=>{
  const data=buildCrmAsaasRecurringLink({plan,method:'PIX',saleId});
  assert.deepEqual([data.chargeType,data.subscriptionCycle,data.billingType,data.value],
    ['RECURRENT','MONTHLY','PIX',79]);
  assert.equal(data.externalReference,'nexus-crm-monthly-'+saleId);
  const event=sourceEvent();
  assert.ok(event);
  const routing=planCrmAsaasProductionDispatch({
    eventRow:{...event,environment:'production',processing_status:'pending'},
    sales:[sale],productCode:'crm',
  });
  assert.equal(routing.worker,'provision');
  assert.equal(routing.canProvision,false); // dispatcher alone never grants
  const calls=[];
  const verified=await previewProductionCrmAsaasPayment({
    eventRow:event,sale,productCode:'crm',
    fetchResource:getter({
      ['/payments/'+paymentId]:payment,
      ['/paymentLinks/'+linkId]:link,
      ['/customers/'+customerId]:customer,
      ['/subscriptions/'+subId]:subscription,
    },calls),
  });
  assert.equal(verified.decision,'verified_for_review');
  assert.equal(verified.canActivateCrm,false);
  assert.equal(verified.amountCents,7900);
  const reserved=await reconcileProductionCrmAsaasSettlement({
    verification:verified,eventId:event.provider_event_id,environment:'production',
    reservationEnabled:true,claimEnabled:true,
    callRpc:async(name,args)=>{
      calls.push('RPC '+name);
      if(name==='reserve_nexus_crm_asaas_production_verified_payment'){
        assert.equal(args.p_sale_id,saleId);
        assert.equal(args.p_provider_payment_id,paymentId);
        return {data:{decision:'reserved_for_review',sale_id:saleId,payment_id:paymentId}};
      }
      if(name==='claim_nexus_crm_asaas_production_provisioning'){
        assert.equal(args.p_sale_id,saleId);
        return {data:{decision:'provision_ready',sale_id:saleId}};
      }
      throw Error('unknown RPC');
    },
  });
  assert.equal(reserved.decision,'ready_for_provisioning');
  assert.equal(reserved.canActivateCrm,false); // separate lease + tenant + email mandatory
  assert.deepEqual(calls,[
    'GET /payments/'+paymentId,'GET /paymentLinks/'+linkId,
    'GET /customers/'+customerId,'GET /subscriptions/'+subId,
    'RPC reserve_nexus_crm_asaas_production_verified_payment',
    'RPC claim_nexus_crm_asaas_production_provisioning',
  ]);
  assert.ok(!JSON.stringify(reserved).includes(sale.registration_number));
});
test('no duplicate financial claim if same event is replayed',async()=>{
  let claims=0;
  const event=sourceEvent(),calls=[];
  const verified=await previewProductionCrmAsaasPayment({
    eventRow:event,sale,productCode:'crm',
    fetchResource:getter({
      ['/payments/'+paymentId]:payment,
      ['/paymentLinks/'+linkId]:link,
      ['/customers/'+customerId]:customer,
      ['/subscriptions/'+subId]:subscription,
    },calls),
  });
  const result=await reconcileProductionCrmAsaasSettlement({
    verification:verified,eventId:event.provider_event_id,environment:'production',
    reservationEnabled:true,claimEnabled:true,
    callRpc:async(name)=>{
      if(name==='claim_nexus_crm_asaas_production_provisioning')claims++;
      return {data:{decision:'already_reserved',sale_id:saleId,payment_id:paymentId}};
    },
  });
  assert.notEqual(result.decision,'ready_for_provisioning');
  assert.equal(claims,0);
});
test('monthly renewal is only accepted for same paid organization, no second tenant',async()=>{
  const already={
    ...sale,sale_status:'provisioned',organization_id:'org-example',
    paid_at:'2026-11-08T13:00:00Z',
    provisioned_at:'2026-11-08T13:03:00Z',
    asaas_subscription_id:subId,provider_customer_id:customerId,
  };
  const access={
    id:'access-example',organization_id:'org-example',product_id:'prod-crm',
    billing_provider:'asaas',billing_mode:'recurring',billing_cycle_months:1,
    commercial_condition:'standard',subscription_status:'active',access_status:'active',
    external_tenant_id:'tenant-example',provider_subscription_id:subId,
    provider_customer_id:customerId,contracted_price_cents:7900,
  };
  const second={...payment,id:'pay_second123456',dueDate:'2026-12-08'};
  const renewalEvent=sourceEvent(second,'evt_renewal1234567');
  const calls=[];
  const renew=await previewProductionCrmAsaasRenewal({
    eventRow:renewalEvent,sale:already,access,productCode:'crm',
    fetchResource:getter({
      ['/payments/'+second.id]:second,
      ['/subscriptions/'+subId]:{...subscription,nextDueDate:'2027-01-08'},
      ['/customers/'+customerId]:customer,
      ['/paymentLinks/'+linkId]:link,
    },calls),
  });
  assert.equal(renew.decision,'verified_renewal_for_review');
  assert.equal(renew.canActivateCrm,false);
  assert.equal(renew.accessId,'access-example');
  assert.deepEqual(calls,[
    'GET /payments/'+second.id,'GET /subscriptions/'+subId,
    'GET /customers/'+customerId,'GET /paymentLinks/'+linkId,
  ]);
  const fraudulent=await previewProductionCrmAsaasRenewal({
    eventRow:renewalEvent,sale:already,access:{...access,organization_id:'other'},
    productCode:'crm',fetchResource:async()=>{throw Error('must not call');},
  });
  assert.notEqual(fraudulent.decision,'verified_renewal_for_review');
});
