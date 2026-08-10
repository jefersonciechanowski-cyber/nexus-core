begin;

create table if not exists public.nexus_plans (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.nexus_products(id) on delete cascade,
  code text not null,
  name text not null,
  description text,
  price_cents bigint not null default 0 check (price_cents >= 0),
  currency text not null default 'BRL' check (currency = 'BRL'),
  billing_interval_months integer not null default 1 check (billing_interval_months in (1,3,6,12)),
  status text not null default 'active' check (status in ('active','inactive')),
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, code),
  unique (id, product_id),
  constraint nexus_plans_code_check check (code ~ '^[a-z0-9-]+$'),
  constraint nexus_plans_name_check check (char_length(btrim(name)) between 2 and 120)
);

create index if not exists nexus_plans_product_idx
  on public.nexus_plans (product_id, status, sort_order);

alter table public.organization_product_access
  add column if not exists plan_id uuid,
  add column if not exists contracted_price_cents bigint,
  add column if not exists contracted_currency text not null default 'BRL';

alter table public.organization_product_access
  drop constraint if exists organization_product_access_contracted_price_check;

alter table public.organization_product_access
  add constraint organization_product_access_contracted_price_check
    check (contracted_price_cents is null or contracted_price_cents >= 0);

alter table public.organization_product_access
  drop constraint if exists organization_product_access_contracted_currency_check;

alter table public.organization_product_access
  add constraint organization_product_access_contracted_currency_check
    check (contracted_currency = 'BRL');

alter table public.organization_product_access
  drop constraint if exists organization_product_access_plan_product_fk;

alter table public.organization_product_access
  add constraint organization_product_access_plan_product_fk
    foreign key (plan_id, product_id)
    references public.nexus_plans (id, product_id)
    on delete restrict;

create index if not exists organization_product_access_plan_idx
  on public.organization_product_access (plan_id);

alter table public.nexus_plans enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'nexus_plans'
      and policyname = 'authenticated read active nexus plans'
  ) then
    create policy "authenticated read active nexus plans"
      on public.nexus_plans for select
      to authenticated
      using (status = 'active' or public.is_nexus_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'nexus_plans'
      and policyname = 'nexus admin manage plans'
  ) then
    create policy "nexus admin manage plans"
      on public.nexus_plans for all
      to authenticated
      using (public.is_nexus_admin())
      with check (public.is_nexus_admin());
  end if;
end;
$$;

grant select on public.nexus_plans to authenticated;
grant insert, update, delete on public.nexus_plans to authenticated;

grant update (
  plan_id,
  plan_name,
  contracted_price_cents,
  contracted_currency,
  subscription_status,
  starts_at,
  renews_at,
  updated_at
) on public.organization_product_access to authenticated;

comment on table public.nexus_plans is
  'Catálogo comercial de planos por produto Nexus, independente do provedor de pagamento.';

comment on column public.organization_product_access.contracted_price_cents is
  'Preço contratado preservado na assinatura. Null identifica acesso sem cobrança comercial definida.';

comment on column public.organization_product_access.plan_id is
  'Plano comercial vinculado ao acesso. Null preserva acessos legados ou sem plano definido.';

commit;
