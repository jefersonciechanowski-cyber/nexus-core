-- SST pilot -> Asaas. Isolated from CRM, Stripe and legacy courtesy access.
-- Apply only after review; public tables stay inaccessible to anon/authenticated.
begin;

create table if not exists public.nexus_sst_asaas_pilot_checkouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id),
  access_id uuid not null references public.organization_product_access(id),
  user_id uuid not null references auth.users(id),
  plan_id uuid not null references public.nexus_plans(id),
  company_name text not null,
  owner_email text not null,
  registration_number text not null,
  amount_cents bigint not null check (amount_cents > 0),
  billing_type text not null check (billing_type in ('PIX','BOLETO')),
  environment text not null check (environment in ('sandbox','production')),
  state text not null default 'reserved' check (state in ('reserved','ready','paid','review')),
  provider_link_id text unique,
  provider_link_url text,
  provider_customer_id text,
  provider_subscription_id text unique,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id),
  unique (access_id)
);
create index if not exists nexus_sst_asaas_pilot_by_link
  on public.nexus_sst_asaas_pilot_checkouts(provider_link_id)
  where provider_link_id is not null;

create table if not exists public.nexus_sst_asaas_payment_events (
  provider_event_id text primary key,
  event_type text not null,
  provider_payment_id text not null,
  provider_link_id text,
  provider_subscription_id text,
  processing_status text not null default 'pending'
    check (processing_status in ('pending','processed','ignored','review')),
  error_code text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists nexus_sst_asaas_event_pending
  on public.nexus_sst_asaas_payment_events(created_at)
  where processing_status='pending';

create table if not exists public.nexus_sst_asaas_verified_payments (
  provider_payment_id text primary key,
  checkout_id uuid not null references public.nexus_sst_asaas_pilot_checkouts(id),
  provider_event_id text not null references public.nexus_sst_asaas_payment_events(provider_event_id),
  provider_subscription_id text not null,
  verified_at timestamptz not null default now(),
  unique(checkout_id,provider_payment_id)
);

alter table public.nexus_sst_asaas_pilot_checkouts enable row level security;
alter table public.nexus_sst_asaas_payment_events enable row level security;
alter table public.nexus_sst_asaas_verified_payments enable row level security;
revoke all on public.nexus_sst_asaas_pilot_checkouts from public, anon, authenticated;
revoke all on public.nexus_sst_asaas_payment_events from public, anon, authenticated;
revoke all on public.nexus_sst_asaas_verified_payments from public, anon, authenticated;
grant select,insert,update on public.nexus_sst_asaas_pilot_checkouts to service_role;
grant select,insert,update on public.nexus_sst_asaas_payment_events to service_role;
grant select,insert on public.nexus_sst_asaas_verified_payments to service_role;

-- The worker has already made fresh authenticated Asaas GETs, verifying
-- payment/link/subscription/customer. This DB function atomically enforces
-- same-tenant ownership, same access, one receipt and plan/employee constraints.
create or replace function public.record_verified_nexus_sst_asaas_payment(
  p_checkout_id uuid,
  p_event_id text,
  p_payment_id text,
  p_customer_id text,
  p_subscription_id text,
  p_next_due_date date,
  p_payment_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_checkout public.nexus_sst_asaas_pilot_checkouts%rowtype;
  v_access public.organization_product_access%rowtype;
  v_plan public.nexus_plans%rowtype;
  v_product_code text;
  v_existing_payment text;
  v_employee_count integer;
begin
  if p_checkout_id is null
    or p_payment_id is null or length(p_payment_id) < 5
    or p_customer_id is null or length(p_customer_id) < 5
    or p_subscription_id is null or length(p_subscription_id) < 5
    or p_payment_status not in ('RECEIVED','CONFIRMED')
    or p_next_due_date is null
    or p_next_due_date < current_date
    or p_next_due_date > current_date + interval '15 months'
  then
    raise exception 'Pagamento ou próxima vigência inválidos';
  end if;

  select * into v_checkout
    from public.nexus_sst_asaas_pilot_checkouts
    where id=p_checkout_id for update;
  if not found or v_checkout.state not in ('ready','paid')
    or v_checkout.environment <> 'production'
    or v_checkout.provider_link_id is null
  then
    raise exception 'Checkout SST não elegível para conversão';
  end if;

  select * into v_access
    from public.organization_product_access
    where id=v_checkout.access_id and organization_id=v_checkout.organization_id
    for update;
  if not found then raise exception 'Vínculo empresarial ausente'; end if;

  select * into v_plan from public.nexus_plans where id=v_checkout.plan_id;
  select code into v_product_code from public.nexus_products where id=v_access.product_id;
  if v_product_code <> 'sst'
    or v_plan.product_id <> v_access.product_id
    or v_plan.status <> 'active'
    or v_plan.code not in ('essencial','profissional','empresarial')
    or v_plan.price_cents <> v_checkout.amount_cents
  then
    raise exception 'Produto/plano SST incompatível';
  end if;

  select count(*) into v_employee_count
    from public.employees
    where organization_id=v_checkout.organization_id and active=true;
  if v_plan.employee_limit is not null and v_employee_count > v_plan.employee_limit then
    raise exception 'Empresa ultrapassou limite do plano selecionado';
  end if;

  select provider_payment_id into v_existing_payment
    from public.nexus_sst_asaas_verified_payments
    where provider_payment_id=p_payment_id;
  if v_existing_payment is not null then
    return jsonb_build_object('applied',false,'reason','payment_already_verified');
  end if;

  if v_checkout.state='ready' then
    if v_access.subscription_status <> 'trial'
      or v_access.plan_id not in (
        select id from public.nexus_plans
          where product_id=v_access.product_id and code='piloto'
      )
    then
      raise exception 'Acesso existente não está em piloto SST';
    end if;

    if exists (
      select 1 from public.organizations
       where registration_number=v_checkout.registration_number
         and id<>v_checkout.organization_id
    ) then raise exception 'CNPJ vinculado a outra empresa'; end if;
    if exists (
      select 1 from public.organizations
       where id=v_checkout.organization_id
         and registration_number is not null
         and registration_number<>v_checkout.registration_number
    ) then raise exception 'CNPJ diferente do cadastro do piloto'; end if;

    update public.organizations set
      registration_type=case when length(v_checkout.registration_number)=14 then 'cnpj' else 'cpf' end,
      registration_number=v_checkout.registration_number,
      updated_at=now()
    where id=v_checkout.organization_id;

    update public.organization_product_access set
      plan_id=v_plan.id,
      plan_name=v_plan.name,
      access_status='active',
      subscription_status='active',
      contracted_price_cents=v_checkout.amount_cents,
      contracted_currency='BRL',
      billing_mode='recurring',
      billing_cycle_months=1,
      billing_provider='asaas',
      provider_customer_id=p_customer_id,
      provider_subscription_id=p_subscription_id,
      asaas_customer_id=p_customer_id,
      asaas_subscription_id=p_subscription_id,
      last_payment_status=p_payment_status,
      last_payment_due_date=current_date,
      last_payment_at=now(),
      renews_at=p_next_due_date,
      updated_at=now()
    where id=v_access.id;

    update public.nexus_accounts set
      plan_id=v_plan.id, updated_at=now()
    where billing_organization_id=v_checkout.organization_id
      and account_type='single_company';

    update public.nexus_sst_asaas_pilot_checkouts set
      state='paid',
      provider_customer_id=p_customer_id,
      provider_subscription_id=p_subscription_id,
      paid_at=now(),
      updated_at=now()
    where id=v_checkout.id;

    insert into public.audit_logs(organization_id,user_id,action,entity,entity_id,metadata)
    values (v_checkout.organization_id,v_checkout.user_id,
      'NEXUS_SST_PILOT_CONVERTED_ASAAS','organization_product_access',v_access.id::text,
      jsonb_build_object('plan_code',v_plan.code,'checkout_id',v_checkout.id,'provider','asaas'));
  else
    if v_access.billing_provider<>'asaas'
      or v_access.provider_subscription_id is distinct from p_subscription_id
      or v_access.provider_customer_id is distinct from p_customer_id
      or v_access.plan_id<>v_checkout.plan_id
    then raise exception 'Renovação não corresponde ao contrato SST'; end if;
    update public.organization_product_access set
      access_status='active',
      subscription_status='active',
      last_payment_status=p_payment_status,
      last_payment_due_date=current_date,
      last_payment_at=now(),
      renews_at=greatest(coalesce(renews_at,current_date),p_next_due_date),
      updated_at=now()
    where id=v_access.id;
  end if;

  insert into public.nexus_sst_asaas_verified_payments (
    provider_payment_id,checkout_id,provider_event_id,provider_subscription_id
  ) values (p_payment_id,v_checkout.id,p_event_id,p_subscription_id);

  insert into public.nexus_payments (
    organization_id, access_id, provider, provider_payment_id,
    provider_subscription_id, provider_customer_id,
    billing_type, provider_status, amount_cents, currency,
    confirmed_at,received_at,external_reference
  ) values (
    v_checkout.organization_id,v_access.id,'asaas',p_payment_id,
    p_subscription_id,p_customer_id,v_checkout.billing_type,p_payment_status,
    v_checkout.amount_cents,'BRL',
    now(),case when p_payment_status='RECEIVED' then now() else null end,
    'sst-pilot-'||v_checkout.id::text
  );

  return jsonb_build_object('applied',true,
    'organizationId',v_checkout.organization_id,
    'accessId',v_access.id,
    'state','active');
end;
$$;

revoke all on function public.record_verified_nexus_sst_asaas_payment(
  uuid,text,text,text,text,date,text) from public,anon,authenticated;
grant execute on function public.record_verified_nexus_sst_asaas_payment(
  uuid,text,text,text,text,date,text) to service_role;
commit;
