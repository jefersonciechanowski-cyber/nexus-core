-- REVIEW ONLY / NEVER RUN ON PRODUCTION WITHOUT AUTHORIZED MIGRATION.
-- Start after reservation + financial claim migrations have been tested.
-- A one-way provisioning lease prevents two workers from creating 2 tenants.
-- A crash leaves 'provisioning' for MANUAL review; never auto-expire a lease
-- while creating users/tenants. Do not automatically retry partial operations.

create or replace function public.begin_nexus_crm_asaas_provisioning(
  p_sale_id uuid,p_payment_id text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_claim public.nexus_crm_asaas_verified_payments%rowtype;
        v_sale public.nexus_sales%rowtype;
begin
  select * into v_claim from public.nexus_crm_asaas_verified_payments
  where sale_id=p_sale_id and provider_payment_id=p_payment_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('decision','manual_review','reason','claim_not_found');
  end if;
  if v_claim.decision='provisioned' then
    return pg_catalog.jsonb_build_object('decision','already_provisioned');
  end if;
  if v_claim.decision<>'provision_ready' then
    return pg_catalog.jsonb_build_object('decision','manual_review','reason','lease_not_available');
  end if;
  select * into v_sale from public.nexus_sales s
  where s.id=p_sale_id and s.provider='asaas' and s.environment='sandbox'
    and s.billing_mode='recurring' and s.billing_cycle_months=1
    and s.sale_status='paid' and s.paid_at is not null
    and s.asaas_subscription_id=v_claim.provider_subscription_id
  for update;
  if not found or v_sale.organization_id is not null or v_sale.user_id is not null then
    return pg_catalog.jsonb_build_object('decision','manual_review','reason','sale_not_new');
  end if;
  if exists(select 1 from public.organizations where registration_number=v_sale.registration_number)
    or exists(select 1 from auth.users where pg_catalog.lower(email)=pg_catalog.lower(v_sale.email)) then
    return pg_catalog.jsonb_build_object('decision','manual_review','reason','identity_already_exists');
  end if;
  update public.nexus_crm_asaas_verified_payments set decision='provisioning',
    updated_at=pg_catalog.now()
  where provider_payment_id=p_payment_id and decision='provision_ready';
  if not found then
    return pg_catalog.jsonb_build_object('decision','manual_review','reason','lease_lost');
  end if;
  return pg_catalog.jsonb_build_object('decision','acquired','sale_id',p_sale_id,'payment_id',p_payment_id);
end; $$;
revoke all on function public.begin_nexus_crm_asaas_provisioning(uuid,text)
  from public,anon,authenticated;
grant execute on function public.begin_nexus_crm_asaas_provisioning(uuid,text) to service_role;

-- Confirmation is allowed ONLY after a real tenant and finance row exist.
-- This function does not create an organization or alter an entitlement.
create or replace function public.complete_nexus_crm_asaas_provisioning(
  p_sale_id uuid,p_payment_id text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_claim public.nexus_crm_asaas_verified_payments%rowtype;
        v_sale public.nexus_sales%rowtype;
        v_access public.organization_product_access%rowtype;
begin
  select * into v_claim from public.nexus_crm_asaas_verified_payments
    where sale_id=p_sale_id and provider_payment_id=p_payment_id for update;
  if not found then return pg_catalog.jsonb_build_object('decision','manual_review','reason','claim_not_found');end if;
  if v_claim.decision='provisioned' then return pg_catalog.jsonb_build_object('decision','already_provisioned');end if;
  if v_claim.decision<>'provisioning' then return pg_catalog.jsonb_build_object('decision','manual_review','reason','lease_not_acquired');end if;
  select * into v_sale from public.nexus_sales where id=p_sale_id
    and sale_status='provisioned' and organization_id is not null
    and user_id is not null and provisioned_at is not null
    and provider='asaas' and environment='sandbox';
  if not found then return pg_catalog.jsonb_build_object('decision','manual_review','reason','sale_incomplete');end if;
  select * into v_access from public.organization_product_access
    where organization_id=v_sale.organization_id
      and product_id=v_sale.product_id and billing_provider='asaas'
      and provider_subscription_id=v_claim.provider_subscription_id
      and subscription_status='active' and access_status='active'
      and external_tenant_id is not null;
  if not found then return pg_catalog.jsonb_build_object('decision','manual_review','reason','tenant_not_provisioned');end if;
  if not exists (
    select 1 from public.nexus_payments p
    where p.provider='asaas' and p.provider_payment_id=p_payment_id
      and p.organization_id=v_sale.organization_id and p.access_id=v_access.id
      and p.provider_subscription_id=v_claim.provider_subscription_id
      and p.amount_cents=v_claim.amount_cents
  ) then return pg_catalog.jsonb_build_object('decision','manual_review','reason','financial_receipt_missing');end if;
  update public.nexus_crm_asaas_verified_payments set decision='provisioned',
    updated_at=pg_catalog.now() where provider_payment_id=p_payment_id and decision='provisioning';
  if not found then raise exception 'provision_lease_lost';end if;
  return pg_catalog.jsonb_build_object('decision','completed','sale_id',p_sale_id);
end; $$;
revoke all on function public.complete_nexus_crm_asaas_provisioning(uuid,text)
  from public,anon,authenticated;
grant execute on function public.complete_nexus_crm_asaas_provisioning(uuid,text) to service_role;
