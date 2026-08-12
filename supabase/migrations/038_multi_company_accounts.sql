begin;

alter table public.nexus_plans
  add column if not exists customer_type text not null default 'single_company',
  add column if not exists organization_limit integer not null default 1,
  add column if not exists employee_limit_scope text not null default 'organization';

alter table public.nexus_plans
  drop constraint if exists nexus_plans_customer_type_check,
  add constraint nexus_plans_customer_type_check check (customer_type in ('single_company','consultancy')),
  drop constraint if exists nexus_plans_organization_limit_check,
  add constraint nexus_plans_organization_limit_check check (organization_limit > 0),
  drop constraint if exists nexus_plans_employee_limit_scope_check,
  add constraint nexus_plans_employee_limit_scope_check check (employee_limit_scope in ('organization','account'));

create table if not exists public.nexus_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  account_type text not null default 'single_company' check (account_type in ('single_company','consultancy')),
  status text not null default 'active' check (status in ('active','suspended')),
  billing_organization_id uuid unique references public.organizations(id) on delete restrict,
  plan_id uuid references public.nexus_plans(id) on delete restrict,
  organization_limit integer not null default 1 check (organization_limit > 0),
  employee_limit_total integer check (employee_limit_total is null or employee_limit_total > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.nexus_account_organizations (
  account_id uuid not null references public.nexus_accounts(id) on delete cascade,
  organization_id uuid not null unique references public.organizations(id) on delete cascade,
  relationship_type text not null default 'managed' check (relationship_type in ('primary','managed')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, organization_id)
);

create table if not exists public.nexus_account_users (
  account_id uuid not null references public.nexus_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_role text not null default 'member' check (account_role in ('owner','manager','member')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, user_id)
);

create table if not exists public.organization_memberships (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null default 'viewer',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index if not exists nexus_account_organizations_account_idx on public.nexus_account_organizations (account_id, active, created_at);
create index if not exists nexus_account_users_user_idx on public.nexus_account_users (user_id, active, account_id);
create index if not exists organization_memberships_user_idx on public.organization_memberships (user_id, active, organization_id);

-- Compatibilidade: cada organização existente começa como uma conta de empresa única.
insert into public.nexus_accounts (name, account_type, status, billing_organization_id, plan_id, organization_limit)
select
  organization.name,
  'single_company',
  case when organization.status = 'active' then 'active' else 'suspended' end,
  organization.id,
  (
    select access.plan_id
    from public.organization_product_access access
    join public.nexus_products product on product.id = access.product_id
    where access.organization_id = organization.id and product.code = 'sst'
    order by access.created_at desc
    limit 1
  ),
  1
from public.organizations organization
on conflict (billing_organization_id) do nothing;

insert into public.nexus_account_organizations (account_id, organization_id, relationship_type, active)
select id, billing_organization_id, 'primary', true
from public.nexus_accounts
where billing_organization_id is not null
on conflict (organization_id) do nothing;

insert into public.nexus_account_users (account_id, user_id, account_role, active)
select account_org.account_id, profile.id, 'owner', profile.active
from public.profiles profile
join public.nexus_account_organizations account_org on account_org.organization_id = profile.organization_id
on conflict (account_id, user_id) do update set active = excluded.active, updated_at = now();

insert into public.organization_memberships (organization_id, user_id, role, active)
select profile.organization_id, profile.id, profile.role, profile.active
from public.profiles profile
where profile.organization_id is not null
on conflict (organization_id, user_id) do update set role = excluded.role, active = excluded.active, updated_at = now();

alter table public.nexus_accounts enable row level security;
alter table public.nexus_account_organizations enable row level security;
alter table public.nexus_account_users enable row level security;
alter table public.organization_memberships enable row level security;

drop policy if exists "account users read own account" on public.nexus_accounts;
create policy "account users read own account" on public.nexus_accounts for select to authenticated using (
  public.is_nexus_admin() or exists (
    select 1 from public.nexus_account_users account_user
    where account_user.account_id = nexus_accounts.id and account_user.user_id = auth.uid() and account_user.active = true
  )
);

drop policy if exists "account users read account organizations" on public.nexus_account_organizations;
create policy "account users read account organizations" on public.nexus_account_organizations for select to authenticated using (
  public.is_nexus_admin() or exists (
    select 1 from public.nexus_account_users account_user
    where account_user.account_id = nexus_account_organizations.account_id and account_user.user_id = auth.uid() and account_user.active = true
  )
);

drop policy if exists "users read own account membership" on public.nexus_account_users;
create policy "users read own account membership" on public.nexus_account_users for select to authenticated using (
  public.is_nexus_admin() or user_id = auth.uid()
);

drop policy if exists "users read own organization memberships" on public.organization_memberships;
create policy "users read own organization memberships" on public.organization_memberships for select to authenticated using (
  public.is_nexus_admin() or user_id = auth.uid()
);

-- Usuário precisa conseguir ler o nome das empresas das quais é membro, não apenas da empresa atualmente selecionada.
drop policy if exists "read own organization" on public.organizations;
create policy "read own organization" on public.organizations for select to authenticated using (
  public.is_nexus_admin()
  or id = public.current_org_id()
  or exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = organizations.id and membership.user_id = auth.uid() and membership.active = true
  )
);

grant select on public.nexus_accounts, public.nexus_account_organizations, public.nexus_account_users, public.organization_memberships to authenticated;
grant select, insert, update, delete on public.nexus_accounts, public.nexus_account_organizations, public.nexus_account_users, public.organization_memberships to service_role;

comment on table public.nexus_accounts is 'Conta comercial Nexus acima das empresas. Empresa única possui uma organização; consultorias podem possuir várias.';
comment on table public.organization_memberships is 'Empresas que um usuário pode acessar. profiles.organization_id continua sendo a empresa atualmente selecionada.';
comment on column public.nexus_accounts.organization_limit is 'Quantidade máxima de empresas ativas permitidas na conta.';
comment on column public.nexus_accounts.employee_limit_total is 'Limite agregado de colaboradores ativos entre todas as empresas da conta multiempresa.';

commit;
