-- Nexus CRM Asaas prepaid expiry. Never creates an invoice or a subscription.
-- Deployment requires separate authorization; workflow gate remains OFF by default.
begin;

create or replace function public.expire_nexus_crm_asaas_prepaid_access(
  p_access_id uuid
) returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_access public.organization_product_access%rowtype;
  v_today date := (now() at time zone 'UTC')::date;
  v_event_id text;
begin
  if p_access_id is null then
    return pg_catalog.jsonb_build_object('applied', false, 'reason', 'invalid_access');
  end if;

  select * into v_access
    from public.organization_product_access
   where id = p_access_id
   for update;

  if not found then
    return pg_catalog.jsonb_build_object('applied', false, 'reason', 'access_not_found');
  end if;

  -- Fail closed: Asaas prepaid, paid CRM, standard commercial terms,
  -- a linked tenant and NO provider recurring subscription.
  if v_access.billing_provider is distinct from 'asaas'
    or v_access.billing_mode is distinct from 'prepaid'
    or v_access.commercial_condition is distinct from 'standard'
    or v_access.provider_subscription_id is not null
    or nullif(pg_catalog.btrim(v_access.external_tenant_id), '') is null
    or not exists (
      select 1 from public.nexus_products p
       where p.id = v_access.product_id and p.code = 'crm'
    ) then
    return pg_catalog.jsonb_build_object('applied', false, 'reason', 'not_eligible');
  end if;

  if v_access.renews_at is null or v_access.renews_at >= v_today then
    return pg_catalog.jsonb_build_object('applied', false, 'reason', 'not_expired');
  end if;

  if v_access.subscription_status = 'past_due' and v_access.access_status = 'suspended' then
    return pg_catalog.jsonb_build_object('applied', false, 'reason', 'already_suspended');
  end if;

  if v_access.subscription_status is distinct from 'active'
    or v_access.access_status is distinct from 'active' then
    return pg_catalog.jsonb_build_object('applied', false, 'reason', 'non_active_contract');
  end if;

  -- Only an independently recorded RECEIVED prepaid Asaas payment may
  -- belong to this expiry pathway. No matching receipt => manual review.
  if not exists (
    select 1 from public.nexus_payments pay
     where pay.access_id = v_access.id
       and pay.organization_id = v_access.organization_id
       and pay.provider = 'asaas'
       and pay.provider_status = 'RECEIVED'
       and pay.received_at is not null
       and pay.billing_type in ('PIX','BOLETO')
       and pay.provider_subscription_id is null
       and pay.amount_cents = v_access.contracted_price_cents
       and pay.amount_cents > 0
  ) then
    return pg_catalog.jsonb_build_object('applied', false, 'reason', 'paid_receipt_not_verified');
  end if;

  v_event_id := 'reconcile:asaas-prepaid-expired:' || v_access.id::text
    || ':' || v_access.renews_at::text;
  update public.organization_product_access
     set subscription_status = 'past_due',
         access_status = 'suspended',
         provider_state_event_id = v_event_id,
         provider_state_event_created_at = now(),
         provider_state_event_type = 'reconcile.asaas_prepaid_expired',
         updated_at = now()
   where id = v_access.id;

  -- The signed CRM entitlement outbox is driven by the caller after commit.
  -- No tenant/customer data, invoice, or payment is deleted or modified.
  return pg_catalog.jsonb_build_object(
    'applied', true, 'reason', 'expired', 'access_status', 'suspended'
  );
end;
$$;

revoke all on function public.expire_nexus_crm_asaas_prepaid_access(uuid)
  from public, anon, authenticated;
grant execute on function public.expire_nexus_crm_asaas_prepaid_access(uuid)
  to service_role;

commit;
