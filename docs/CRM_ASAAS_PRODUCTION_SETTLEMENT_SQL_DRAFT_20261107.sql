-- REVIEW STAGING ONLY. Do not apply to production until the hard-off
-- production worker and source proofs have been independently approved.
-- Four service-only SQL financial transitions; independent from Sandbox tables.
-- The function caller must have JUST performed four independent Asaas GETs.
begin;


create table if not exists public.nexus_crm_asaas_production_verified_payments (
  provider_payment_id text primary key,
  provider_event_id text not null unique,
  sale_id uuid not null references public.nexus_sales(id),
  provider_subscription_id text not null,
  amount_cents bigint not null check (amount_cents > 0),
  billing_type text not null check (billing_type in ('PIX','BOLETO')),
  decision text not null default 'verified_pending_provisioning'
    check (decision in ('verified_pending_provisioning','provision_ready','provisioning','manual_review','provisioned')),
  verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_asaas_prod_verified_payment_id_format
    check (provider_payment_id ~ '^pay_[A-Za-z0-9_-]{5,120}$'),
  constraint crm_asaas_prod_verified_subscription_id_format
    check (provider_subscription_id ~ '^sub_[A-Za-z0-9_-]{5,120}$')
);
create index if not exists nexus_crm_asaas_production_verified_payments_sale_idx
  on public.nexus_crm_asaas_production_verified_payments (sale_id, verified_at desc);

alter table public.nexus_crm_asaas_production_verified_payments enable row level security;
revoke all on public.nexus_crm_asaas_production_verified_payments from public, anon, authenticated;

create or replace function public.reserve_nexus_crm_asaas_production_verified_payment(
  p_sale_id uuid, p_provider_event_id text,
  p_provider_payment_id text, p_provider_subscription_id text,
  p_amount_cents bigint, p_billing_type text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_sale public.nexus_sales%rowtype;
  v_event public.nexus_crm_asaas_production_events%rowtype;
  v_existing public.nexus_crm_asaas_production_verified_payments%rowtype;
  v_payment_link text;
begin
  if p_sale_id is null
    or p_provider_event_id !~ '^asaas:evt_[A-Za-z0-9_&.-]{6,150}$'
    or p_provider_payment_id !~ '^pay_[A-Za-z0-9_-]{5,120}$'
    or p_provider_subscription_id !~ '^sub_[A-Za-z0-9_-]{5,120}$'
    or p_amount_cents is null or p_amount_cents <= 0
    or p_billing_type not in ('PIX','BOLETO') then
    return jsonb_build_object('decision','manual_review','reason','invalid_reservation');
  end if;

  select s.* into v_sale
  from public.nexus_sales s
  join public.nexus_products p on p.id = s.product_id
  where s.id = p_sale_id and p.code = 'crm'
    and s.provider = 'asaas' and s.environment = 'production'
  for update of s;

  if not found or v_sale.sale_status not in ('checkout_created','paid','provisioned')
    or v_sale.billing_mode <> 'recurring' or v_sale.billing_cycle_months <> 1
    or v_sale.source <> 'site-captacao'
    or v_sale.checkout_amount_cents is distinct from p_amount_cents
    or v_sale.asaas_checkout_id is null then
    return jsonb_build_object('decision','manual_review','reason','sale_not_eligible');
  end if;

  select * into v_event from public.nexus_crm_asaas_production_events
  where provider_event_id=p_provider_event_id and environment='production'
    and event_type in ('PAYMENT_RECEIVED','PAYMENT_CONFIRMED');
  -- Validate event identity and monetary value before a numeric cast.
  if not found or (v_event.payload->>'event') is distinct from v_event.event_type
    or (v_event.payload#>>'{resource,id}') is distinct from p_provider_payment_id
    or (v_event.payload#>>'{resource,subscription}') is distinct from p_provider_subscription_id
    or (v_event.payload#>>'{resource,billingType}') is distinct from p_billing_type
    or jsonb_typeof(v_event.payload#>'{resource,value}') is distinct from 'number'
    or coalesce((v_event.payload#>>'{resource,value}') ~ '^[0-9]{1,12}([.][0-9]{1,2})?$', false) is not true then
    return jsonb_build_object('decision','manual_review','reason','event_not_matching');
  end if;
  if round(((v_event.payload#>>'{resource,value}')::numeric) * 100)::bigint <> p_amount_cents then
    return jsonb_build_object('decision','manual_review','reason','event_not_matching');
  end if;
  v_payment_link := v_event.payload#>>'{resource,paymentLink}';
  if v_payment_link is distinct from v_sale.asaas_checkout_id
    and (v_sale.asaas_subscription_id is null
      or v_sale.asaas_subscription_id <> p_provider_subscription_id) then
    return jsonb_build_object('decision','manual_review','reason','payment_not_linked');
  end if;
  if v_sale.asaas_subscription_id is not null
    and v_sale.asaas_subscription_id <> p_provider_subscription_id then
    return jsonb_build_object('decision','manual_review','reason','subscription_conflict');
  end if;

  -- Critical concurrency boundary: only one sale may reserve this subscription.
  -- A transaction-level advisory lock serializes independent sales racing to
  -- claim the same subscription. Does not change provider subscription state.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_provider_subscription_id, 16471));
  if exists (
    select 1 from public.nexus_crm_asaas_production_verified_payments v
      where v.provider_subscription_id=p_provider_subscription_id and v.sale_id<>p_sale_id
  ) then
    return jsonb_build_object('decision','manual_review','reason','subscription_reserved_elsewhere');
  end if;
  if exists (
    select 1 from public.nexus_crm_asaas_production_verified_payments v
      where v.sale_id=p_sale_id and v.provider_subscription_id<>p_provider_subscription_id
  ) then
    return jsonb_build_object('decision','manual_review','reason','sale_has_another_subscription');
  end if;

  insert into public.nexus_crm_asaas_production_verified_payments
    (provider_payment_id,provider_event_id,sale_id,provider_subscription_id,amount_cents,billing_type)
  values (p_provider_payment_id,p_provider_event_id,p_sale_id,p_provider_subscription_id,p_amount_cents,p_billing_type)
  on conflict do nothing;

  select * into v_existing from public.nexus_crm_asaas_production_verified_payments
    where provider_payment_id=p_provider_payment_id;
  if not found
    or v_existing.sale_id<>p_sale_id
    or v_existing.provider_event_id<>p_provider_event_id
    or v_existing.provider_subscription_id<>p_provider_subscription_id
    or v_existing.amount_cents<>p_amount_cents
    or v_existing.billing_type<>p_billing_type then
    return jsonb_build_object('decision','manual_review','reason','provider_payment_conflict');
  end if;

  -- Intentionally never UPDATE nexus_sales / nexus_payments / access here.
  return jsonb_build_object('decision','reserved_for_review',
    'sale_id',p_sale_id,'payment_id',p_provider_payment_id,
    'reservation_state',v_existing.decision);
end; $$;

revoke all on function public.reserve_nexus_crm_asaas_production_verified_payment(
  uuid,text,text,text,bigint,text) from public, anon, authenticated;
grant execute on function public.reserve_nexus_crm_asaas_production_verified_payment(
  uuid,text,text,text,bigint,text) to service_role;

grant select, insert, update on public.nexus_crm_asaas_production_verified_payments to service_role;


create or replace function public.claim_nexus_crm_asaas_production_provisioning(
  p_sale_id uuid,
  p_provider_payment_id text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_reservation public.nexus_crm_asaas_production_verified_payments%rowtype;
  v_sale public.nexus_sales%rowtype;
  v_plan public.nexus_plans%rowtype;
begin
  if p_sale_id is null or p_provider_payment_id !~ '^pay_[A-Za-z0-9_-]{5,120}$' then
    return pg_catalog.jsonb_build_object('decision','manual_review','reason','invalid_payment');
  end if;

  -- Row-level CAS, serialized per payment. A webhook can be delivered twice,
  -- or a worker can retry; only one transaction can win the claim.
  select * into v_reservation
    from public.nexus_crm_asaas_production_verified_payments
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
    where s.id=p_sale_id and s.provider='asaas' and s.environment='production'
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
      and public_visible=true and code in ('start','pro','gestao');
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
    where other.id<>p_sale_id and other.provider in ('asaas','stripe') and other.environment='production'
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

  update public.nexus_crm_asaas_production_verified_payments
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

revoke all on function public.claim_nexus_crm_asaas_production_provisioning(uuid,text)
  from public, anon, authenticated;
grant execute on function public.claim_nexus_crm_asaas_production_provisioning(uuid,text)
  to service_role;



create or replace function public.begin_nexus_crm_asaas_production_provisioning(
  p_sale_id uuid,p_payment_id text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_claim public.nexus_crm_asaas_production_verified_payments%rowtype;
        v_sale public.nexus_sales%rowtype;
begin
  select * into v_claim from public.nexus_crm_asaas_production_verified_payments
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
  where s.id=p_sale_id and s.provider='asaas' and s.environment='production'
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
  update public.nexus_crm_asaas_production_verified_payments set decision='provisioning',
    updated_at=pg_catalog.now()
  where provider_payment_id=p_payment_id and decision='provision_ready';
  if not found then
    return pg_catalog.jsonb_build_object('decision','manual_review','reason','lease_lost');
  end if;
  return pg_catalog.jsonb_build_object('decision','acquired','sale_id',p_sale_id,'payment_id',p_payment_id);
end; $$;
revoke all on function public.begin_nexus_crm_asaas_production_provisioning(uuid,text)
  from public,anon,authenticated;
grant execute on function public.begin_nexus_crm_asaas_production_provisioning(uuid,text) to service_role;

create or replace function public.complete_nexus_crm_asaas_production_provisioning(
  p_sale_id uuid,p_payment_id text
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_claim public.nexus_crm_asaas_production_verified_payments%rowtype;
        v_sale public.nexus_sales%rowtype;
        v_access public.organization_product_access%rowtype;
begin
  select * into v_claim from public.nexus_crm_asaas_production_verified_payments
    where sale_id=p_sale_id and provider_payment_id=p_payment_id for update;
  if not found then return pg_catalog.jsonb_build_object('decision','manual_review','reason','claim_not_found');end if;
  if v_claim.decision='provisioned' then return pg_catalog.jsonb_build_object('decision','already_provisioned');end if;
  if v_claim.decision<>'provisioning' then return pg_catalog.jsonb_build_object('decision','manual_review','reason','lease_not_acquired');end if;
  select * into v_sale from public.nexus_sales where id=p_sale_id
    and sale_status='provisioned' and organization_id is not null
    and user_id is not null and provisioned_at is not null
    and provider='asaas' and environment='production';
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
  update public.nexus_crm_asaas_production_verified_payments set decision='provisioned',
    updated_at=pg_catalog.now() where provider_payment_id=p_payment_id and decision='provisioning';
  if not found then raise exception 'provision_lease_lost';end if;
  return pg_catalog.jsonb_build_object('decision','completed','sale_id',p_sale_id);
end; $$;
revoke all on function public.complete_nexus_crm_asaas_production_provisioning(uuid,text)
  from public,anon,authenticated;
grant execute on function public.complete_nexus_crm_asaas_production_provisioning(uuid,text) to service_role;

commit;
