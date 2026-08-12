begin;

-- PR #44: conta comercial acima das organizações.
-- Uma empresa comum continua com uma única organização. Consultorias podem
-- administrar várias organizações sem misturar os dados de cada tenant.

alter table public.nexus_plans
  add column if not exists customer_type text not null default 'single_company',
  add column if not exists organization_limit integer not null default 1,
  add column if not exists employee_limit_scope text not null default 'organization';

alter table public.nexus_plans
  drop constraint if exists nexus_plans_customer_type_check,
  add constraint nexus_plans_customer_type_check
    check (customer_type in ('single_company','consultancy')),
  drop constraint if exists nexus_plans_organization_limit_check,
  add constraint nexus_plans_organization_limit_check
    check (organization_limit > 0),
  drop constraint if exists nexus_plans_employee_limit_scope_check,
  add constraint nexus_plans_employee_limit_scope_check
    check (employee_limit_scope in ('organization','account'));

create table if not exists public.nexus_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  account_type text not null default 'single_company'
    check (account_type in ('single_company','consultancy')),
  status text not null default 'active'
    check (status in ('active','suspended')),
  billing_organization_id uuid references public.organizations(id) on delete restrict,
  plan_id uuid references public.nexus_plans(id) on delete restrict,
  organization_limit integer not null default 1 check (organization_limit > 0),
  employee_limit_total integer check (employee_limit_total is null or employee_limit_total > 0),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (billing_organization_id)
);

create table if not exists public.nexus_account_organizations (
  account_id uuid not null references public.nexus_accounts(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  relationship_type text not null default 'managed'
    check (relationship_type in ('primary','managed')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (account_id, organization_id),
  unique (organization_id)
);

create table if not exists public.nexus_account_users (
  account_id uuid not null references public.nexus_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_role text not null default 'member'
    check (account_role in ('owner','manager','member')),
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

create index if not exists nexus_account_organizations_account_idx
  on public.nexus_account_organizations (account_id, active, created_at);
create index if not exists nexus_account_users_user_idx
  on public.nexus_account_users (user_id, active, account_id);
create index if not exists organization_memberships_user_idx
  on public.organization_memberships (user_id, active, organization_id);

-- Backfill: cada organização atual vira uma conta single-company, sem alterar
-- o tenant nem a assinatura já existente.
insert into public.nexus_accounts (
  name,
  account_type,
  status,
  billing_organization_id,
  plan_id,
  organization_limit,
  employee_limit_total
)
select
  organization.name,
  'single_company',
  case when organization.status = 'active' then 'active' else 'suspended' end,
  organization.id,
  (
    select access.plan_id
    from public.organization_product_access access
    join public.nexus_products product on product.id = access.product_id
    where access.organization_id = organization.id
      and product.code = 'sst'
    order by access.created_at desc
    limit 1
  ),
  1,
  null
from public.organizations organization
on conflict (billing_organization_id) do nothing;

insert into public.nexus_account_organizations (
  account_id,
  organization_id,
  relationship_type,
  active
)
select account.id, account.billing_organization_id, 'primary', true
from public.nexus_accounts account
where account.billing_organization_id is not null
on conflict (organization_id) do nothing;

insert into public.nexus_account_users (
  account_id,
  user_id,
  account_role,
  active
)
select
  account_org.account_id,
  profile.id,
  'owner',
  profile.active
from public.profiles profile
join public.nexus_account_organizations account_org
  on account_org.organization_id = profile.organization_id
on conflict (account_id, user_id) do update set
  active = excluded.active,
  updated_at = now();

insert into public.organization_memberships (
  organization_id,
  user_id,
  role,
  active
)
select profile.organization_id, profile.id, profile.role, profile.active
from public.profiles profile
where profile.organization_id is not null
on conflict (organization_id, user_id) do update set
  role = excluded.role,
  active = excluded.active,
  updated_at = now();

alter table public.nexus_accounts enable row level security;
alter table public.nexus_account_organizations enable row level security;
alter table public.nexus_account_users enable row level security;
alter table public.organization_memberships enable row level security;

drop policy if exists "account users read own account" on public.nexus_accounts;
create policy "account users read own account"
  on public.nexus_accounts for select
  to authenticated
  using (
    public.is_nexus_admin()
    or exists (
      select 1
      from public.nexus_account_users account_user
      where account_user.account_id = nexus_accounts.id
        and account_user.user_id = auth.uid()
        and account_user.active = true
    )
  );

drop policy if exists "account users read account organizations" on public.nexus_account_organizations;
create policy "account users read account organizations"
  on public.nexus_account_organizations for select
  to authenticated
  using (
    public.is_nexus_admin()
    or exists (
      select 1
      from public.nexus_account_users account_user
      where account_user.account_id = nexus_account_organizations.account_id
        and account_user.user_id = auth.uid()
        and account_user.active = true
    )
  );

drop policy if exists "account users read account users" on public.nexus_account_users;
create policy "account users read account users"
  on public.nexus_account_users for select
  to authenticated
  using (
    public.is_nexus_admin()
    or user_id = auth.uid()
    or exists (
      select 1
      from public.nexus_account_users viewer
      where viewer.account_id = nexus_account_users.account_id
        and viewer.user_id = auth.uid()
        and viewer.active = true
        and viewer.account_role in ('owner','manager')
    )
  );

drop policy if exists "users read own organization memberships" on public.organization_memberships;
create policy "users read own organization memberships"
  on public.organization_memberships for select
  to authenticated
  using (public.is_nexus_admin() or user_id = auth.uid());

grant select on public.nexus_accounts to authenticated;
grant select on public.nexus_account_organizations to authenticated;
grant select on public.nexus_account_users to authenticated;
grant select on public.organization_memberships to authenticated;

grant select, insert, update, delete on public.nexus_accounts to service_role;
grant select, insert, update, delete on public.nexus_account_organizations to service_role;
grant select, insert, update, delete on public.nexus_account_users to service_role;
grant select, insert, update, delete on public.organization_memberships to service_role;

-- Troca segura da empresa ativa. O restante do SST continua usando
-- current_org_id(), portanto toda a RLS existente permanece válida.
create or replace function public.switch_organization(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership public.organization_memberships%rowtype;
  v_organization public.organizations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida.' using errcode = 'P0001';
  end if;

  select * into v_membership
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.user_id = auth.uid()
    and membership.active = true;

  if v_membership.user_id is null then
    raise exception 'Você não possui acesso a esta empresa.' using errcode = 'P0001';
  end if;

  select * into v_organization
  from public.organizations organization
  where organization.id = p_organization_id
    and organization.status = 'active';

  if v_organization.id is null then
    raise exception 'Esta empresa está indisponível.' using errcode = 'P0001';
  end if;

  update public.profiles
  set organization_id = p_organization_id,
      role = v_membership.role
  where id = auth.uid()
    and active = true;

  if not found then
    raise exception 'Perfil de acesso não encontrado.' using errcode = 'P0001';
  end if;

  insert into public.audit_logs (organization_id, user_id, action, entity, entity_id, metadata)
  values (p_organization_id, auth.uid(), 'SWITCH_ORGANIZATION', 'organization', p_organization_id::text, '{}'::jsonb);

  return jsonb_build_object(
    'organizationId', v_organization.id,
    'organizationName', v_organization.name,
    'organizationSlug', v_organization.slug,
    'role', v_membership.role::text
  );
end;
$$;

revoke all on function public.switch_organization(uuid) from public;
grant execute on function public.switch_organization(uuid) to authenticated;

-- Criação de uma nova empresa pela própria consultoria.
create or replace function public.create_managed_organization(
  p_name text,
  p_registration_type text default null,
  p_registration_number text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account public.nexus_accounts%rowtype;
  v_account_role text;
  v_current_organization_id uuid;
  v_new_organization_id uuid := gen_random_uuid();
  v_slug_base text;
  v_slug text;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Sessão inválida.' using errcode = 'P0001';
  end if;

  select profile.organization_id
    into v_current_organization_id
  from public.profiles profile
  where profile.id = auth.uid()
    and profile.active = true;

  select account.*, account_user.account_role
    into v_account, v_account_role
  from public.nexus_account_organizations account_org
  join public.nexus_accounts account on account.id = account_org.account_id
  join public.nexus_account_users account_user on account_user.account_id = account.id
  where account_org.organization_id = v_current_organization_id
    and account_org.active = true
    and account_user.user_id = auth.uid()
    and account_user.active = true
  limit 1;

  if v_account.id is null or v_account.status <> 'active' then
    raise exception 'Conta Nexus indisponível.' using errcode = 'P0001';
  end if;

  if v_account.account_type <> 'consultancy' then
    raise exception 'Sua conta não possui gestão multiempresa.' using errcode = 'P0001';
  end if;

  if v_account_role not in ('owner','manager') then
    raise exception 'Você não possui permissão para criar empresas nesta conta.' using errcode = 'P0001';
  end if;

  if nullif(btrim(p_name), '') is null or char_length(btrim(p_name)) > 160 then
    raise exception 'Informe um nome de empresa válido.' using errcode = 'P0001';
  end if;

  if p_registration_type is not null and p_registration_type not in ('CNPJ','CPF') then
    raise exception 'Tipo de documento inválido.' using errcode = 'P0001';
  end if;

  if p_registration_number is not null and (
    (p_registration_type = 'CNPJ' and p_registration_number !~ '^[0-9A-Z]{14}$')
    or (p_registration_type = 'CPF' and p_registration_number !~ '^[0-9]{11}$')
    or p_registration_type is null
  ) then
    raise exception 'Documento da empresa inválido.' using errcode = 'P0001';
  end if;

  select count(*)::integer into v_count
  from public.nexus_account_organizations account_org
  where account_org.account_id = v_account.id
    and account_org.active = true;

  if v_count >= v_account.organization_limit then
    raise exception 'Limite de % empresas atingido para esta conta.', v_account.organization_limit using errcode = 'P0001';
  end if;

  v_slug_base := trim(both '-' from regexp_replace(lower(unaccent(btrim(p_name))), '[^a-z0-9]+', '-', 'g'));
  if v_slug_base = '' then v_slug_base := 'empresa'; end if;
  v_slug := left(v_slug_base, 52) || '-' || substr(v_new_organization_id::text, 1, 8);

  insert into public.organizations (
    id, name, slug, status, trade_name, registration_type, registration_number
  ) values (
    v_new_organization_id,
    btrim(p_name),
    v_slug,
    'active',
    btrim(p_name),
    p_registration_type,
    p_registration_number
  );

  insert into public.nexus_account_organizations (
    account_id, organization_id, relationship_type, active
  ) values (
    v_account.id, v_new_organization_id, 'managed', true
  );

  insert into public.organization_memberships (
    organization_id, user_id, role, active
  )
  select
    v_new_organization_id,
    account_user.user_id,
    case
      when account_user.account_role in ('owner','manager') then 'org_admin'::public.app_role
      else 'viewer'::public.app_role
    end,
    true
  from public.nexus_account_users account_user
  where account_user.account_id = v_account.id
    and account_user.active = true
  on conflict (organization_id, user_id) do nothing;

  -- A organização gerenciada recebe o direito de uso dos produtos ativos da
  -- organização de cobrança, mas sem criar uma segunda cobrança.
  insert into public.organization_product_access (
    organization_id,
    product_id,
    access_status,
    subscription_status,
    plan_name,
    starts_at,
    renews_at,
    plan_id,
    contracted_price_cents,
    contracted_currency,
    billing_mode,
    billing_cycle_months
  )
  select
    v_new_organization_id,
    access.product_id,
    access.access_status,
    access.subscription_status,
    'Incluído na conta multiempresa',
    access.starts_at,
    access.renews_at,
    access.plan_id,
    null,
    access.contracted_currency,
    access.billing_mode,
    access.billing_cycle_months
  from public.organization_product_access access
  where access.organization_id = v_account.billing_organization_id
    and access.access_status = 'active'
  on conflict (organization_id, product_id) do nothing;

  insert into public.audit_logs (organization_id, user_id, action, entity, entity_id, metadata)
  values (
    v_new_organization_id,
    auth.uid(),
    'CREATE_MANAGED_ORGANIZATION',
    'organization',
    v_new_organization_id::text,
    jsonb_build_object('account_id', v_account.id)
  );

  return v_new_organization_id;
end;
$$;

revoke all on function public.create_managed_organization(text,text,text) from public;
grant execute on function public.create_managed_organization(text,text,text) to authenticated;

-- Administração Nexus: transforma uma conta existente em multiempresa e
-- define limites comerciais independentes.
create or replace function public.configure_nexus_account(
  p_billing_organization_id uuid,
  p_account_type text,
  p_account_name text,
  p_organization_limit integer,
  p_employee_limit_total integer default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_plan_id uuid;
begin
  if not public.is_nexus_admin() then
    raise exception 'Apenas a administração Nexus pode configurar contas.' using errcode = 'P0001';
  end if;

  if p_account_type not in ('single_company','consultancy') then
    raise exception 'Tipo de conta inválido.' using errcode = 'P0001';
  end if;

  if p_organization_limit is null or p_organization_limit < 1 then
    raise exception 'Limite de empresas inválido.' using errcode = 'P0001';
  end if;

  if p_account_type = 'single_company' and p_organization_limit <> 1 then
    raise exception 'Conta de empresa única deve possuir limite de 1 empresa.' using errcode = 'P0001';
  end if;

  select account_org.account_id
    into v_account_id
  from public.nexus_account_organizations account_org
  where account_org.organization_id = p_billing_organization_id
  limit 1;

  if v_account_id is null then
    raise exception 'Conta comercial da empresa não encontrada.' using errcode = 'P0001';
  end if;

  select access.plan_id into v_plan_id
  from public.organization_product_access access
  join public.nexus_products product on product.id = access.product_id
  where access.organization_id = p_billing_organization_id
    and product.code = 'sst'
  order by access.created_at desc
  limit 1;

  update public.nexus_accounts
  set name = coalesce(nullif(btrim(p_account_name), ''), name),
      account_type = p_account_type,
      plan_id = v_plan_id,
      organization_limit = p_organization_limit,
      employee_limit_total = p_employee_limit_total,
      updated_at = now()
  where id = v_account_id;

  return v_account_id;
end;
$$;

revoke all on function public.configure_nexus_account(uuid,text,text,integer,integer) from public;
grant execute on function public.configure_nexus_account(uuid,text,text,integer,integer) to authenticated;

-- Limite de quantidade de empresas também é protegido no banco.
create or replace function public.enforce_nexus_account_organization_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_count integer;
begin
  if coalesce(new.active, true) is not true then return new; end if;

  select organization_limit into v_limit
  from public.nexus_accounts
  where id = new.account_id;

  select count(*)::integer into v_count
  from public.nexus_account_organizations account_org
  where account_org.account_id = new.account_id
    and account_org.active = true
    and (tg_op = 'INSERT' or account_org.organization_id <> new.organization_id);

  if v_limit is not null and v_count >= v_limit then
    raise exception 'Limite de % empresas atingido para esta conta.', v_limit using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists nexus_account_organization_limit_guard on public.nexus_account_organizations;
create trigger nexus_account_organization_limit_guard
before insert or update of active, account_id on public.nexus_account_organizations
for each row execute function public.enforce_nexus_account_organization_limit();

-- Mantém o comportamento antigo para empresa única. Na consultoria, o limite
-- passa a ser agregado entre todas as organizações da conta.
create or replace function public.enforce_sst_employee_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_account_type text;
  v_account_limit integer;
  v_limit integer;
  v_active_count integer;
begin
  if coalesce(new.active, true) is not true then return new; end if;

  select account.id, account.account_type, account.employee_limit_total
    into v_account_id, v_account_type, v_account_limit
  from public.nexus_account_organizations account_org
  join public.nexus_accounts account on account.id = account_org.account_id
  where account_org.organization_id = new.organization_id
    and account_org.active = true
    and account.status = 'active'
  limit 1;

  if v_account_type = 'consultancy' then
    if v_account_limit is null then return new; end if;

    select count(*)::integer into v_active_count
    from public.employees employee
    join public.nexus_account_organizations account_org
      on account_org.organization_id = employee.organization_id
     and account_org.account_id = v_account_id
     and account_org.active = true
    where employee.active = true
      and (tg_op = 'INSERT' or employee.id <> new.id);

    if v_active_count >= v_account_limit then
      raise exception 'Limite total de % colaboradores ativos atingido para a conta multiempresa.', v_account_limit
        using errcode = 'P0001';
    end if;

    return new;
  end if;

  select plan.employee_limit
    into v_limit
  from public.organization_product_access access
  join public.nexus_products product on product.id = access.product_id
  left join public.nexus_plans plan on plan.id = access.plan_id
  where access.organization_id = new.organization_id
    and product.code = 'sst'
    and access.access_status = 'active'
  order by access.created_at desc
  limit 1;

  if v_limit is null then return new; end if;

  select count(*)::integer into v_active_count
  from public.employees employee
  where employee.organization_id = new.organization_id
    and employee.active = true
    and (tg_op = 'INSERT' or employee.id <> new.id);

  if v_active_count >= v_limit then
    raise exception 'Limite de % colaboradores ativos atingido para o plano contratado.', v_limit
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on table public.nexus_accounts is
  'Conta comercial Nexus. Empresa única possui uma organização; consultorias podem administrar várias organizações isoladas.';
comment on table public.organization_memberships is
  'Empresas que um usuário pode acessar. profiles.organization_id permanece como a empresa atualmente selecionada.';
comment on column public.nexus_accounts.organization_limit is
  'Quantidade máxima de empresas/organizações ativas permitidas nesta conta.';
comment on column public.nexus_accounts.employee_limit_total is
  'Limite agregado de colaboradores ativos entre todas as empresas de uma conta multiempresa.';

commit;
