-- REVIEW ONLY / NOT APPLIED (2026-10-26)
-- Requires CRM_ASAAS_SETTLEMENT_RESERVATION_SQL_DRAFT.sql to be reviewed,
-- turned into a CLI-generated migration, and tested in an isolated sandbox.
-- This transition records FINANCIAL CONFIRMATION ONLY; it does not grant
-- CRM entitlements, send emails, create organizations, or modify courtesy.

create or replace function public.claim_nexus_crm_asaas_provisioning(
  p_sale_id uuid,
  p_provider_payment_id text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_reservation public.nexus_crm_asaas_verified_payments%rowtype;
  v_sale public.nexus_sales%rowtype;
  v_plan public.nexus_plans%rowtype;
begin
  if p_sale_id is null or p_provider_payment_id !~ '^pay_[A-Za-z0-9_-]{5,120}$' then
    return pg_catalog.jsonb_build_object('decision','manual_review','reason','invalid_payment');
  end if;

  -- Row-level CAS, serialized per payment. A webhook can be delivered twice,
  -- or a worker can retry; only one transaction can win the claim.
  select * into v_reservation
    from public.nexus_crm_asaas_verified_payments
    where provider_payment_id=p_provider_payment_id and sale_id=p_sale_id
    for update;
  if not found then
    return pg_catalog.jsonb_build_object('decision','manual_review','reason','payment_not_reserved');
  end if;
  if v_reservation.decision = 'provision_ready' then
    return pg_catalog.jsonb_build_object('decision','already_claimed','sale_id',p_sale_id);
  end if;
  if v_reservation.decision <> 'verified_pending_provisioning' then
    return pg_catalog.jsonb_build_object('decision','manual_review','reason','reservation_not_eligible');
  end if;

  select s.* into v_sale from public.nexus_sales s
    join public.nexus_products p on p.id=s.product_id and p.code='crm'
    where s.id=p_sale_id and s.provider='asaas' and s.environment='sandbox'
    for update of s;
  if not found
    or v_sale.sale_status <> 'checkout_created'
    or v_sale.paid_at is not null
    or v_sale.organization_id is not null or v_sale.user_id is not null
    or v_sale.asaas_checkout_id is null
    or v_sale.billing_mode <> 'recurring' or v_sale.billing_cycle_months <> 1
    or v_sale.source <> 'site-captacao'
    or v_sale.asaas_subscription_id is distinct from null then
    return pg_catalog.jsonb_build_object('decision','manual_review','reason','sale_not_eligible');
  end if;

  select * into v_plan from public.nexus_plans
    where id=v_sale.plan_id and product_id=v_sale.product_id and status='active'
      and billing_interval_months=1 and currency='BRL'
      and code in ('start','pro','gestao');
  if not found or v_sale.checkout_amount_cents is distinct from v_plan.price_cents
    or v_reservation.amount_cents is distinct from v_plan.price_cents then
    return pg_catalog.jsonb_build_object('decision','manual_review','reason','plan_or_amount_changed');
  end if;

  -- Serialize separate paid checkouts for the same document and email.
  -- A lock on an individual sale alone cannot protect from two concurrently
  -- paid public checkouts attempting to create two distinct organizations.
  if v_sale.registration_number is null or pg_catalog.length(v_sale.registration_number)<11
    or v_sale.email is null or pg_catalog.strpos(v_sale.email,'@')=0 then
    return pg_catalog.jsonb_build_object('decision','manual_review','reason','sale_identity_missing');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('crm:asaas:doc:'||v_sale.registration_number,13479));
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('crm:asaas:email:'||pg_catalog.lower(v_sale.email),13479));
  if exists (
    select 1 from public.nexus_sales other
    where other.id<>p_sale_id and other.provider='asaas' and other.environment='sandbox'
      and other.source='site-captacao' and other.sale_status in ('paid','provisioned')
      and (other.registration_number=v_sale.registration_number
        or pg_catalog.lower(other.email)=pg_catalog.lower(v_sale.email))
  ) then
    return pg_catalog.jsonb_build_object('decision','manual_review','reason','identity_already_claimed');
  end if;

  -- Fail closed on existing agency/courtesy/other tenant identity. The separate
  -- stage-07 authenticated account-linking flow must handle such cases.
  if exists(select 1 from public.organizations
     where registration_number=v_sale.registration_number)
    or exists(select 1 from auth.users
     where pg_catalog.lower(email)=pg_catalog.lower(v_sale.email))
    or exists(select 1 from public.nexus_payments
     where provider_payment_id=p_provider_payment_id) then
    return pg_catalog.jsonb_build_object('decision','manual_review','reason','identity_or_payment_already_exists');
  end if;
  if exists(select 1 from public.nexus_sales
     where provider='asaas' and id<>p_sale_id
       and provider_subscription_id=v_reservation.provider_subscription_id) then
    return pg_catalog.jsonb_build_object('decision','manual_review','reason','subscription_used_elsewhere');
  end if;

  update public.nexus_sales
    set sale_status='paid', paid_at=pg_catalog.now(),
      provider_subscription_id=v_reservation.provider_subscription_id,
      asaas_subscription_id=v_reservation.provider_subscription_id,
      updated_at=pg_catalog.now()
    where id=p_sale_id and sale_status='checkout_created';

  if not found then
    return pg_catalog.jsonb_build_object('decision','manual_review','reason','sale_state_changed');
  end if;

  update public.nexus_crm_asaas_verified_payments
    set decision='provision_ready',updated_at=pg_catalog.now()
    where provider_payment_id=p_provider_payment_id and sale_id=p_sale_id
      and decision='verified_pending_provisioning';
  if not found then
    -- This exception rolls back the preceding sale update atomically.
    raise exception 'payment claim state changed concurrently';
  end if;

  return pg_catalog.jsonb_build_object(
    'decision','provision_ready','sale_id',p_sale_id,'payment_id',p_provider_payment_id
  );
end;
$$;

revoke all on function public.claim_nexus_crm_asaas_provisioning(uuid,text)
  from public, anon, authenticated;
grant execute on function public.claim_nexus_crm_asaas_provisioning(uuid,text)
  to service_role;

-- Requires authenticated internal orchestration after a fresh Asaas GET
-- against payment/link/customer/subscription. Not callable by web clients.
-- Never automate this DRAFT on the production database.
