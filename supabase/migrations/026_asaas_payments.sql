begin;

alter table public.organization_product_access
  add column if not exists asaas_customer_id text,
  add column if not exists asaas_subscription_id text,
  add column if not exists last_payment_status text,
  add column if not exists last_payment_due_date date,
  add column if not exists last_payment_at timestamptz;

create unique index if not exists organization_product_access_asaas_subscription_uidx
  on public.organization_product_access (asaas_subscription_id)
  where asaas_subscription_id is not null;

create table if not exists public.nexus_payment_checkouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  access_id uuid not null references public.organization_product_access(id) on delete cascade,
  plan_id uuid references public.nexus_plans(id) on delete restrict,
  provider text not null default 'asaas' check (provider = 'asaas'),
  environment text not null default 'sandbox' check (environment in ('sandbox','production')),
  external_reference text not null unique,
  provider_checkout_id text unique,
  provider_checkout_url text,
  provider_customer_id text,
  provider_subscription_id text,
  status text not null default 'created'
    check (status in ('created','active','paid','canceled','expired','failed')),
  amount_cents bigint not null check (amount_cents >= 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  billing_interval_months integer not null check (billing_interval_months in (1,3,6,12)),
  expires_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists nexus_payment_checkouts_org_idx
  on public.nexus_payment_checkouts (organization_id, created_at desc);
create index if not exists nexus_payment_checkouts_access_idx
  on public.nexus_payment_checkouts (access_id, created_at desc);
create index if not exists nexus_payment_checkouts_customer_idx
  on public.nexus_payment_checkouts (provider_customer_id)
  where provider_customer_id is not null;

create table if not exists public.nexus_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  access_id uuid not null references public.organization_product_access(id) on delete cascade,
  checkout_id uuid references public.nexus_payment_checkouts(id) on delete set null,
  provider text not null default 'asaas' check (provider = 'asaas'),
  provider_payment_id text not null unique,
  provider_subscription_id text,
  provider_customer_id text,
  billing_type text,
  provider_status text not null,
  amount_cents bigint not null default 0 check (amount_cents >= 0),
  net_amount_cents bigint check (net_amount_cents is null or net_amount_cents >= 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  due_date date,
  confirmed_at timestamptz,
  received_at timestamptz,
  external_reference text,
  invoice_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists nexus_payments_org_idx
  on public.nexus_payments (organization_id, due_date desc, created_at desc);
create index if not exists nexus_payments_access_idx
  on public.nexus_payments (access_id, due_date desc, created_at desc);
create index if not exists nexus_payments_subscription_idx
  on public.nexus_payments (provider_subscription_id)
  where provider_subscription_id is not null;

create table if not exists public.nexus_payment_webhook_events (
  provider_event_id text primary key,
  provider text not null default 'asaas' check (provider = 'asaas'),
  event_type text not null,
  resource_id text,
  payload jsonb not null default '{}'::jsonb,
  processed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.nexus_payment_checkouts enable row level security;
alter table public.nexus_payments enable row level security;
alter table public.nexus_payment_webhook_events enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='nexus_payment_checkouts' and policyname='organization read own payment checkouts'
  ) then
    create policy "organization read own payment checkouts"
      on public.nexus_payment_checkouts for select to authenticated
      using (organization_id = public.current_org_id() or public.is_nexus_admin());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='nexus_payment_checkouts' and policyname='nexus admin manage payment checkouts'
  ) then
    create policy "nexus admin manage payment checkouts"
      on public.nexus_payment_checkouts for all to authenticated
      using (public.is_nexus_admin()) with check (public.is_nexus_admin());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='nexus_payments' and policyname='organization read own payments'
  ) then
    create policy "organization read own payments"
      on public.nexus_payments for select to authenticated
      using (organization_id = public.current_org_id() or public.is_nexus_admin());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='nexus_payments' and policyname='nexus admin manage payments'
  ) then
    create policy "nexus admin manage payments"
      on public.nexus_payments for all to authenticated
      using (public.is_nexus_admin()) with check (public.is_nexus_admin());
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='public' and tablename='nexus_payment_webhook_events' and policyname='nexus admin read payment webhook events'
  ) then
    create policy "nexus admin read payment webhook events"
      on public.nexus_payment_webhook_events for select to authenticated
      using (public.is_nexus_admin());
  end if;
end;
$$;

grant select on public.nexus_payment_checkouts to authenticated;
grant select on public.nexus_payments to authenticated;
grant select on public.nexus_payment_webhook_events to authenticated;

comment on table public.nexus_payment_checkouts is
  'Jornadas de checkout hospedado criadas no Asaas para assinaturas Nexus.';
comment on table public.nexus_payments is
  'Cobranças e recebimentos reconciliados por webhook do Asaas.';
comment on table public.nexus_payment_webhook_events is
  'Eventos do Asaas persistidos para idempotência e auditoria do processamento.';

commit;
