// Pure authorization preflight for a future authenticated trial -> paid
// conversion. NEVER creates a payment link or mutates an entitlement.
// Inputs MUST come from DB + verified session, not a customer-submitted role.
const denied=reason=>Object.freeze({decision:'manual_review',reason,
  canCreateCheckout:false,canChangeAccess:false});
const uuid=v=>typeof v==='string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

export function assessCrmTrialToPaid({organization,access,claim,product,plan,actor}={}) {
  if(!organization || !access || !claim || !product || !plan || !actor)
    return denied('missing_verified_context');
  if(!uuid(organization.id) || !uuid(access.id) || !uuid(product.id)
    || !uuid(plan.id) || !uuid(actor.userId)
    || actor.sessionVerified!==true || actor.canManageBilling!==true
    || actor.organizationId!==organization.id) {
    return denied('not_authenticated_billing_owner');
  }
  if(product.code!=='crm' || access.product_id!==product.id
    || plan.product_id!==product.id || access.organization_id!==organization.id
    || claim.organization_id!==organization.id || claim.access_id!==access.id
    || claim.state!=='provisioned'
    || ![15,30].includes(Number(claim.trial_days))) {
    return denied('trial_relationship_mismatch');
  }
  if(access.commercial_condition!=='standard'
    || access.subscription_status!=='trial'
    || !['active','suspended'].includes(access.access_status)
    || access.billing_provider!=null || access.provider_subscription_id!=null
    || access.external_tenant_id==null || access.external_tenant_id===''
    || Number(access.contracted_price_cents)!==0) {
    return denied('existing_paid_courtesy_or_unprovisioned');
  }
  if(plan.status!=='active' || plan.public_visible!==true
    || plan.currency!=='BRL' || plan.billing_interval_months!==1
    || !Number.isSafeInteger(Number(plan.price_cents))
    || Number(plan.price_cents)<=0) return denied('plan_not_monthly_eligible');
  return Object.freeze({
    decision:'eligible_for_authenticated_upgrade',
    reason:'preflight_only',canCreateCheckout:false,canChangeAccess:false,
    organizationId:organization.id,accessId:access.id,
    // The existing CRM tenant must be preserved; ownership must be checked
    // again inside a future atomic service-role conversion RPC.
    externalTenantId:access.external_tenant_id,planId:plan.id,
  });
}
