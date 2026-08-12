begin;

-- Somente administradores da empresa são owners da conta por padrão.
-- Outros perfis existentes permanecem membros, evitando elevar privilégios ao
-- converter posteriormente uma empresa em consultoria.
update public.nexus_account_users account_user
set account_role = case
      when profile.role in ('nexus_admin','org_admin') then 'owner'
      else 'member'
    end,
    updated_at = now()
from public.profiles profile
where profile.id = account_user.user_id;

create index if not exists nexus_accounts_plan_idx
  on public.nexus_accounts (plan_id) where plan_id is not null;
create index if not exists nexus_accounts_created_by_idx
  on public.nexus_accounts (created_by) where created_by is not null;

-- RLS equivalente, usando initplans para não reavaliar auth.uid() por linha.
drop policy if exists "account users read own account" on public.nexus_accounts;
create policy "account users read own account" on public.nexus_accounts for select to authenticated using (
  (select public.is_nexus_admin()) or exists (
    select 1 from public.nexus_account_users account_user
    where account_user.account_id = nexus_accounts.id
      and account_user.user_id = (select auth.uid())
      and account_user.active = true
  )
);

drop policy if exists "account users read account organizations" on public.nexus_account_organizations;
create policy "account users read account organizations" on public.nexus_account_organizations for select to authenticated using (
  (select public.is_nexus_admin()) or exists (
    select 1 from public.nexus_account_users account_user
    where account_user.account_id = nexus_account_organizations.account_id
      and account_user.user_id = (select auth.uid())
      and account_user.active = true
  )
);

drop policy if exists "users read own account membership" on public.nexus_account_users;
create policy "users read own account membership" on public.nexus_account_users for select to authenticated using (
  (select public.is_nexus_admin()) or user_id = (select auth.uid())
);

drop policy if exists "users read own organization memberships" on public.organization_memberships;
create policy "users read own organization memberships" on public.organization_memberships for select to authenticated using (
  (select public.is_nexus_admin()) or user_id = (select auth.uid())
);

drop policy if exists "read own organization" on public.organizations;
create policy "read own organization" on public.organizations for select to authenticated using (
  (select public.is_nexus_admin())
  or id = (select public.current_org_id())
  or exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = organizations.id
      and membership.user_id = (select auth.uid())
      and membership.active = true
  )
);

-- Um usuário pode listar todas e somente as empresas para as quais possui
-- membership. Não precisa ser usuário da conta comercial da consultoria.
create or replace function public.get_my_organizations()
returns table (
  organization_id uuid,
  organization_name text,
  organization_slug text,
  organization_status text,
  membership_role text,
  is_current boolean,
  relationship_type text
)
language sql
security definer
set search_path = public
stable
as $$
  select
    organization.id,
    organization.name,
    organization.slug,
    organization.status,
    membership.role::text,
    organization.id = profile.organization_id,
    account_org.relationship_type
  from public.organization_memberships membership
  join public.organizations organization on organization.id=membership.organization_id
  join public.profiles profile on profile.id=membership.user_id
  join public.nexus_account_organizations account_org on account_org.organization_id=organization.id and account_org.active=true
  join public.nexus_accounts account on account.id=account_org.account_id and account.status='active'
  where membership.user_id=auth.uid()
    and membership.active=true
    and organization.status='active'
  order by (organization.id = profile.organization_id) desc, account_org.relationship_type, lower(organization.name);
$$;

revoke all on function public.get_my_organizations() from public, anon;
grant execute on function public.get_my_organizations() to authenticated;

-- Usuário da consultoria recebe o resumo agregado. Usuário convidado somente
-- para uma empresa gerenciada recebe um resumo local, sem metadados da carteira.
create or replace function public.get_my_nexus_account_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_current_org uuid;
  v_current_org_name text;
  v_account_id uuid;
  v_account_name text;
  v_account_type text;
  v_account_status text;
  v_account_role text;
  v_billing_org uuid;
  v_org_limit integer;
  v_employee_limit integer;
  v_org_count integer;
  v_employee_count integer;
begin
  if v_user_id is null then raise exception 'Sessão inválida.' using errcode='P0001'; end if;

  select profile.organization_id, organization.name
    into v_current_org, v_current_org_name
  from public.profiles profile
  left join public.organizations organization on organization.id=profile.organization_id
  where profile.id=v_user_id and profile.active=true;

  select account.id,account.name,account.account_type,account.status,account_user.account_role,
         account.billing_organization_id,account.organization_limit,account.employee_limit_total
    into v_account_id,v_account_name,v_account_type,v_account_status,v_account_role,
         v_billing_org,v_org_limit,v_employee_limit
  from public.nexus_account_organizations account_org
  join public.nexus_accounts account on account.id=account_org.account_id
  left join public.nexus_account_users account_user
    on account_user.account_id=account.id
   and account_user.user_id=v_user_id
   and account_user.active=true
  where account_org.organization_id=v_current_org
    and account_org.active=true
  limit 1;

  if v_account_id is null then raise exception 'Conta Nexus não encontrada.' using errcode='P0001'; end if;

  if v_account_role is null then
    select count(*)::integer into v_employee_count
    from public.employees
    where organization_id=v_current_org and active=true;

    return jsonb_build_object(
      'accountId',null,
      'accountName',coalesce(v_current_org_name,'Empresa'),
      'accountType','managed_company',
      'accountStatus',v_account_status,
      'accountRole','member',
      'billingOrganizationId',null,
      'organizationLimit',1,
      'organizationCount',1,
      'employeeLimitTotal',null,
      'activeEmployeeCount',v_employee_count,
      'currentOrganizationId',v_current_org
    );
  end if;

  select count(*)::integer into v_org_count
  from public.nexus_account_organizations
  where account_id=v_account_id and active=true;

  select count(*)::integer into v_employee_count
  from public.employees employee
  join public.nexus_account_organizations account_org
    on account_org.organization_id=employee.organization_id
   and account_org.account_id=v_account_id
   and account_org.active=true
  where employee.active=true;

  return jsonb_build_object(
    'accountId',v_account_id,
    'accountName',v_account_name,
    'accountType',v_account_type,
    'accountStatus',v_account_status,
    'accountRole',v_account_role,
    'billingOrganizationId',v_billing_org,
    'organizationLimit',v_org_limit,
    'organizationCount',v_org_count,
    'employeeLimitTotal',v_employee_limit,
    'activeEmployeeCount',v_employee_count,
    'currentOrganizationId',v_current_org
  );
end;
$$;

revoke all on function public.get_my_nexus_account_summary() from public, anon;
grant execute on function public.get_my_nexus_account_summary() to authenticated;

-- Compatibilidade de novos perfis sem promover todos os usuários a owner.
create or replace function public.ensure_nexus_account_for_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_account_type text;
  v_relationship text;
  v_org_name text;
  v_account_role text;
begin
  if new.organization_id is null then return new; end if;

  select account_org.account_id, account.account_type, account_org.relationship_type
    into v_account_id, v_account_type, v_relationship
  from public.nexus_account_organizations account_org
  join public.nexus_accounts account on account.id=account_org.account_id
  where account_org.organization_id=new.organization_id
  limit 1;

  if v_account_id is null then
    select name into v_org_name from public.organizations where id=new.organization_id;

    insert into public.nexus_accounts (
      name,account_type,status,billing_organization_id,plan_id,organization_limit,created_by
    ) values (
      coalesce(v_org_name,'Conta Nexus'),'single_company','active',new.organization_id,
      (select access.plan_id
       from public.organization_product_access access
       join public.nexus_products product on product.id=access.product_id
       where access.organization_id=new.organization_id and product.code='sst'
       order by access.created_at desc limit 1),
      1,new.id
    ) returning id into v_account_id;

    insert into public.nexus_account_organizations (account_id,organization_id,relationship_type,active)
    values (v_account_id,new.organization_id,'primary',true);

    v_account_type := 'single_company';
    v_relationship := 'primary';
  end if;

  if v_account_type='single_company' and v_relationship='primary' then
    v_account_role := case when new.role in ('nexus_admin','org_admin') then 'owner' else 'member' end;
    insert into public.nexus_account_users (account_id,user_id,account_role,active)
    values (v_account_id,new.id,v_account_role,new.active)
    on conflict (account_id,user_id) do update set account_role=excluded.account_role,active=excluded.active,updated_at=now();
  end if;

  insert into public.organization_memberships (organization_id,user_id,role,active)
  values (new.organization_id,new.id,new.role,new.active)
  on conflict (organization_id,user_id) do update set role=excluded.role,active=excluded.active,updated_at=now();

  return new;
end;
$$;

revoke all on function public.ensure_nexus_account_for_profile() from public, anon, authenticated;

comment on function public.get_my_organizations() is 'Lista somente empresas com membership explícita do usuário; clientes finais de uma consultoria não recebem a carteira inteira.';
comment on function public.get_my_nexus_account_summary() is 'Resumo agregado somente para usuário da conta; usuário de empresa gerenciada recebe resumo local.';

commit;
