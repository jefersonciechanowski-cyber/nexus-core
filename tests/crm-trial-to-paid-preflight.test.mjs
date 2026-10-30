import test from 'node:test';
import assert from 'node:assert/strict';
import {assessCrmTrialToPaid} from '../supabase/functions/_shared/crm-trial-to-paid-preflight.mjs';

const id={org:'a187d10a-86c2-4304-b571-ef3a7d0f32d1',access:'a187d10a-86c2-4304-b571-ef3a7d0f32d2',
  product:'a187d10a-86c2-4304-b571-ef3a7d0f32d3',plan:'a187d10a-86c2-4304-b571-ef3a7d0f32d4',
  actor:'a187d10a-86c2-4304-b571-ef3a7d0f32d5'};
const base={
  organization:{id:id.org},
  access:{id:id.access,organization_id:id.org,product_id:id.product,
    commercial_condition:'standard',subscription_status:'trial',access_status:'active',
    billing_provider:null,provider_subscription_id:null,external_tenant_id:'existing-crm-tenant',
    contracted_price_cents:0},
  claim:{organization_id:id.org,access_id:id.access,state:'provisioned',trial_days:15},
  product:{id:id.product,code:'crm'},
  plan:{id:id.plan,product_id:id.product,status:'active',public_visible:true,currency:'BRL',
    billing_interval_months:1,price_cents:7900},
  actor:{userId:id.actor,organizationId:id.org,sessionVerified:true,canManageBilling:true},
};

test('existing trial tenant can be prepared for upgrade but never charged by preflight',()=>{
  for(const days of [15,30]){
    const result=assessCrmTrialToPaid({...base,claim:{...base.claim,trial_days:days}});
    assert.deepEqual(result,{
      decision:'eligible_for_authenticated_upgrade',reason:'preflight_only',
      canCreateCheckout:false,canChangeAccess:false,
      organizationId:id.org,accessId:id.access,
      externalTenantId:'existing-crm-tenant',planId:id.plan,
    });
  }
});

test('trials with duplicate owners, third-party profiles, courtesy or existing billing are denied',()=>{
  const invalid=[
    {actor:{...base.actor,sessionVerified:false}},
    {actor:{...base.actor,canManageBilling:false}},
    {actor:{...base.actor,organizationId:'different'}},
    {claim:{...base.claim,access_id:id.org}},
    {claim:{...base.claim,state:'reserved'}},
    {claim:{...base.claim,trial_days:90}},
    {access:{...base.access,commercial_condition:'courtesy'}},
    {access:{...base.access,commercial_condition:'founder'}},
    {access:{...base.access,subscription_status:'active'}},
    {access:{...base.access,billing_provider:'asaas'}},
    {access:{...base.access,provider_subscription_id:'sub_existing'}},
    {access:{...base.access,external_tenant_id:null}},
    {access:{...base.access,organization_id:'other'}},
    {plan:{...base.plan,billing_interval_months:12}},
    {plan:{...base.plan,price_cents:0}},
    {plan:{...base.plan,public_visible:false}},
    {plan:{...base.plan,currency:'USD'}},
    {product:{...base.product,code:'sst'}},
  ];
  for(const patch of invalid){
    const result=assessCrmTrialToPaid({...base,...patch});
    assert.equal(result.decision,'manual_review',JSON.stringify(patch));
    assert.equal(result.canCreateCheckout,false);
    assert.equal(result.canChangeAccess,false);
  }
});
