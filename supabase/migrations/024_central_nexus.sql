begin;

create table if not exists public.nexus_products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  app_path text not null,
  status text not null default 'active'
    check (status in ('active', 'inactive')),
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nexus_products_code_check check (code ~ '^[a-z0-9-]+$'),
  constraint nexus_products_app_path_check check (app_path like '/apps/%')
);

create table if not exists public.organization_product_access (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.nexus_products(id) on delete cascade,
  access_status text not null default 'active'
    check (access_status in ('active', 'suspended')),
  subscription_status text not null default 'legacy'
    check (subscription_status in ('legacy', 'trial', 'active', 'past_due', 'cancelled')),
  plan_name text,
  starts_at date,
  renews_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, product_id)
);

create index if not exists organization_product_access_org_idx
  on public.organization_product_access (organization_id);

create index if not exists organization_product_access_product_idx
  on public.organization_product_access (product_id);

alter table public.nexus_products enable row level security;
alter table public.organization_product_access enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'nexus_products'
      and policyname = 'authenticated read nexus products'
  ) then
    create policy "authenticated read nexus products"
      on public.nexus_products for select
      to authenticated
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'nexus_products'
      and policyname = 'nexus admin manage products'
  ) then
    create policy "nexus admin manage products"
      on public.nexus_products for all
      to authenticated
      using (public.is_nexus_admin())
      with check (public.is_nexus_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_product_access'
      and policyname = 'organization read own product access'
  ) then
    create policy "organization read own product access"
      on public.organization_product_access for select
      to authenticated
      using (
        organization_id = public.current_org_id()
        or public.is_nexus_admin()
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_product_access'
      and policyname = 'nexus admin manage product access'
  ) then
    create policy "nexus admin manage product access"
      on public.organization_product_access for all
      to authenticated
      using (public.is_nexus_admin())
      with check (public.is_nexus_admin());
  end if;
end;
$$;

grant select on public.nexus_products to authenticated;
grant select, insert, update, delete on public.organization_product_access to authenticated;

insert into public.nexus_products (
  code,
  name,
  description,
  app_path,
  status,
  sort_order
) values (
  'sst',
  'Nexus SST',
  'Gestão de saúde e segurança do trabalho.',
  '/apps/sst-controle/',
  'active',
  10
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  app_path = excluded.app_path,
  status = excluded.status,
  sort_order = excluded.sort_order,
  updated_at = now();

-- Todas as organizações existentes pertencem à fase anterior do produto,
-- quando o Nexus Core operava apenas o SST. O backfill preserva esse acesso
-- como legado, sem declarar uma cobrança que ainda não foi integrada.
insert into public.organization_product_access (
  organization_id,
  product_id,
  access_status,
  subscription_status,
  plan_name,
  starts_at
)
select
  organization.id,
  product.id,
  'active',
  'legacy',
  'Acesso existente',
  current_date
from public.organizations organization
cross join public.nexus_products product
where product.code = 'sst'
on conflict (organization_id, product_id) do nothing;

commit;
