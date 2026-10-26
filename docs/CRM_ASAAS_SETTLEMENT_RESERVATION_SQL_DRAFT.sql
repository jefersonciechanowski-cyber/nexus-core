-- REVIEW-ONLY SQL DRAFT (26 Oct 2026). DO NOT APPLY TO PRODUCTION.
-- Promote to a proper Supabase CLI-generated migration after sandbox approval.
-- Stores a verified payment reservation; NEVER changes customer access.
-- Existing company courtesy, provider entitlements and subscriptions untouched.

create table if not exists public.nexus_crm_asaas_verified_payments (
  provider_payment_id text primary key,
  provider_event_id text not null unique,
  sale_id uuid not null references public.nexus_sales(id),
  provider_subscription_id text not null,
  amount_cents bigint not null check (amount_cents > 0),
  billing_type text not null check (billing_type in ('PIX','BOLETO')),
  decision text not null default 'verified_pending_provisioning'
    check (decision in ('verified_pending_provisioning','provision_ready','manual_review','provisioned')),
  verified_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint crm_asaas_verified_payment_id_format
    check (provider_payment_id ~ '^pay_[A-Za-z0-9_-]{5,120}$'),
  constraint crm_asaas_verified_subscription_id_format
    check (provider_subscription_id ~ '^sub_[A-Za-z0-9_-]{5,120}$')
);
create index if not exists nexus_crm_asaas_verified_payments_sale_idx
  on public.nexus_crm_asaas_verified_payments (sale_id, verified_at desc);

alter table public.nexus_crm_asaas_verified_payments enable row level security;
revoke all on public.nexus_crm_asaas_verified_payments from public, anon, authenticated;
-- No anon/authenticated RLS policies. Only a restricted RPC may reserve.

create or replace function public.reserve_nexus_crm_asaas_verified_payment(
  p_sale_id uuid, p_provider_event_id text,
  p_provider_payment_id text, p_provider_subscription_id text,
  p_amount_cents bigint, p_billing_type text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_sale public.nexus_sales%rowtype;
  v_event public.nexus_payment_webhook_events%rowtype;
  v_existing public.nexus_crm_asaas_verified_payments%rowtype;
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
    and s.provider = 'asaas' and s.environment = 'sandbox'
  for update of s;

  if not found or v_sale.sale_status not in ('checkout_created','paid','provisioned')
    or v_sale.billing_mode <> 'recurring' or v_sale.billing_cycle_months <> 1
    or v_sale.source <> 'site-captacao'
    or v_sale.checkout_amount_cents is distinct from p_amount_cents
    or v_sale.asaas_checkout_id is null then
    return jsonb_build_object('decision','manual_review','reason','sale_not_eligible');
  end if;

  select * into v_event from public.nexus_payment_webhook_events
  where provider_event_id=p_provider_event_id and provider='asaas'
    and event_type in ('PAYMENT_RECEIVED','PAYMENT_CONFIRMED');
  if not found or (v_event.payload->>'event') <> v_event.event_type
    or (v_event.payload#>>'{resource,id}') <> p_provider_payment_id
    or (v_event.payload#>>'{resource,subscription}') <> p_provider_subscription_id
    or (v_event.payload#>>'{resource,billingType}') <> p_billing_type
    or jsonb_typeof(v_event.payload#>'{resource,value}') <> 'number'
    or round(((v_event.payload#>>'{resource,value}')::numeric) * 100)::bigint <> p_amount_cents then
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
    select 1 from public.nexus_crm_asaas_verified_payments v
      where v.provider_subscription_id=p_provider_subscription_id and v.sale_id<>p_sale_id
  ) then
    return jsonb_build_object('decision','manual_review','reason','subscription_reserved_elsewhere');
  end if;
  if exists (
    select 1 from public.nexus_crm_asaas_verified_payments v
      where v.sale_id=p_sale_id and v.provider_subscription_id<>p_provider_subscription_id
  ) then
    return jsonb_build_object('decision','manual_review','reason','sale_has_another_subscription');
  end if;

  insert into public.nexus_crm_asaas_verified_payments
    (provider_payment_id,provider_event_id,sale_id,provider_subscription_id,amount_cents,billing_type)
  values (p_provider_payment_id,p_provider_event_id,p_sale_id,p_provider_subscription_id,p_amount_cents,p_billing_type)
  on conflict do nothing;

  select * into v_existing from public.nexus_crm_asaas_verified_payments
    where provider_payment_id=p_provider_payment_id;
  if not found
    or v_existing.sale_id<>p_sale_id
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

revoke all on function public.reserve_nexus_crm_asaas_verified_payment(
  uuid,text,text,text,bigint,text) from public, anon, authenticated;
grant execute on function public.reserve_nexus_crm_asaas_verified_payment(
  uuid,text,text,text,bigint,text) to service_role;
-- This function is NOT a payment-proof oracle: only the internal verifier,
-- after fresh GET checks with Asaas, is allowed to call it with service_role.
