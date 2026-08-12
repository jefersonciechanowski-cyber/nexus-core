begin;

create or replace function public.get_my_nexus_account_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_current_org uuid;
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

  select organization_id into v_current_org
  from public.profiles
  where id=v_user_id and active=true;

  select account.id,account.name,account.account_type,account.status,account_user.account_role,
         account.billing_organization_id,account.organization_limit,account.employee_limit_total
    into v_account_id,v_account_name,v_account_type,v_account_status,v_account_role,
         v_billing_org,v_org_limit,v_employee_limit
  from public.nexus_account_organizations account_org
  join public.nexus_accounts account on account.id=account_org.account_id
  join public.nexus_account_users account_user on account_user.account_id=account.id
  where account_org.organization_id=v_current_org
    and account_org.active=true
    and account_user.user_id=v_user_id
    and account_user.active=true
  limit 1;

  if v_account_id is null then raise exception 'Conta Nexus não encontrada.' using errcode='P0001'; end if;

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

revoke all on function public.get_my_nexus_account_summary() from public;
grant execute on function public.get_my_nexus_account_summary() to authenticated;

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
  join public.nexus_account_users account_user on account_user.account_id=account.id and account_user.user_id=membership.user_id and account_user.active=true
  where membership.user_id=auth.uid()
    and membership.active=true
    and organization.status='active'
  order by (organization.id = profile.organization_id) desc, account_org.relationship_type, lower(organization.name);
$$;

revoke all on function public.get_my_organizations() from public;
grant execute on function public.get_my_organizations() to authenticated;

comment on function public.get_my_nexus_account_summary() is 'Resumo multiempresa sem expor dados de outras empresas; retorna apenas contagens e limites da conta do usuário.';
comment on function public.get_my_organizations() is 'Lista somente as empresas que o usuário autenticado pode selecionar dentro da conta Nexus ativa.';

commit;
