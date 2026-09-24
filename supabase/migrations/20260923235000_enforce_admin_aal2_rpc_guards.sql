begin;

-- Close MFA bypass paths for Nexus admin actions exposed through the Data API.
-- Nexus admins must have an AAL2 session for critical administrative mutations,
-- while non-admin authenticated users keep their existing allowed read flows.

create or replace function public.admin_mfa_gate()
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and exists (
       select 1
       from public.profiles p
       where p.id = auth.uid()
         and p.active = true
         and (
           p.role <> 'nexus_admin'::public.app_role
           or public.is_nexus_admin_aal2()
         )
     );
$$;

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
  v_current_org_count integer;
begin
  if not public.is_nexus_admin_aal2() then
    raise exception 'Apenas a administração Nexus com autenticação em duas etapas pode configurar contas.'
      using errcode = '42501';
  end if;
  if p_account_type not in ('single_company','consultancy') then raise exception 'Tipo de conta inválido.' using errcode = 'P0001'; end if;
  if p_organization_limit is null or p_organization_limit < 1 then raise exception 'Limite de empresas inválido.' using errcode = 'P0001'; end if;
  if p_account_type = 'single_company' and p_organization_limit <> 1 then raise exception 'Conta de empresa única deve possuir limite de 1 empresa.' using errcode = 'P0001'; end if;
  if p_employee_limit_total is not null and p_employee_limit_total < 1 then raise exception 'Limite de colaboradores inválido.' using errcode = 'P0001'; end if;

  select account_id into v_account_id
  from public.nexus_account_organizations
  where organization_id = p_billing_organization_id
  limit 1;
  if v_account_id is null then raise exception 'Conta comercial da empresa não encontrada.' using errcode = 'P0001'; end if;

  select count(*)::integer into v_current_org_count
  from public.nexus_account_organizations
  where account_id = v_account_id and active = true;
  if v_current_org_count > p_organization_limit then raise exception 'A conta já possui % empresas ativas; o novo limite não pode ser menor.', v_current_org_count using errcode = 'P0001'; end if;

  select access.plan_id into v_plan_id
  from public.organization_product_access access
  join public.nexus_products product on product.id = access.product_id
  where access.organization_id = p_billing_organization_id and product.code = 'sst'
  order by access.created_at desc limit 1;

  update public.nexus_accounts
  set name = coalesce(nullif(btrim(p_account_name),''),name),
      account_type = p_account_type,
      plan_id = v_plan_id,
      organization_limit = p_organization_limit,
      employee_limit_total = case when p_account_type = 'consultancy' then p_employee_limit_total else null end,
      configuration_source = 'manual',
      updated_at = now()
  where id = v_account_id;

  return v_account_id;
end;
$$;

create or replace function public.enforce_nexus_admin_recent_mfa_on_organization_create()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null
     and exists (
       select 1 from public.profiles p
       where p.id = auth.uid() and p.active = true and p.role = 'nexus_admin'::public.app_role
     )
     and not public.is_nexus_admin_aal2() then
    raise exception 'A verificação em duas etapas do administrador Nexus é obrigatória.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.enforce_nexus_admin_recent_mfa_on_profile_context_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null
     and auth.uid() = old.id
     and old.role = 'nexus_admin'::public.app_role
     and (new.organization_id is distinct from old.organization_id or new.role is distinct from old.role)
     and not public.is_nexus_admin_aal2() then
    raise exception 'A verificação em duas etapas do administrador Nexus é obrigatória.' using errcode = '42501';
  end if;
  return new;
end;
$$;

commit;
