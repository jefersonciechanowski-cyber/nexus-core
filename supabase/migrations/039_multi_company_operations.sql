begin;

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

create or replace function public.switch_organization(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.app_role;
  v_name text;
  v_slug text;
begin
  if auth.uid() is null then raise exception 'Sessão inválida.' using errcode = 'P0001'; end if;

  select membership.role, organization.name, organization.slug
    into v_role, v_name, v_slug
  from public.organization_memberships membership
  join public.organizations organization on organization.id = membership.organization_id
  join public.nexus_account_organizations account_org on account_org.organization_id = organization.id and account_org.active = true
  join public.nexus_accounts account on account.id = account_org.account_id and account.status = 'active'
  where membership.organization_id = p_organization_id
    and membership.user_id = auth.uid()
    and membership.active = true
    and organization.status = 'active'
  limit 1;

  if v_role is null then raise exception 'Você não possui acesso a esta empresa.' using errcode = 'P0001'; end if;

  update public.profiles
  set organization_id = p_organization_id, role = v_role
  where id = auth.uid() and active = true;

  if not found then raise exception 'Perfil de acesso não encontrado.' using errcode = 'P0001'; end if;

  insert into public.audit_logs (organization_id, user_id, action, entity, entity_id, metadata)
  values (p_organization_id, auth.uid(), 'SWITCH_ORGANIZATION', 'organization', p_organization_id::text, '{}'::jsonb);

  return jsonb_build_object('organizationId',p_organization_id,'organizationName',v_name,'organizationSlug',v_slug,'role',v_role::text);
end;
$$;

revoke all on function public.switch_organization(uuid) from public;
grant execute on function public.switch_organization(uuid) to authenticated;

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
  v_current_org uuid;
  v_account_id uuid;
  v_account_type text;
  v_account_status text;
  v_billing_org uuid;
  v_org_limit integer;
  v_account_role text;
  v_count integer;
  v_new_org uuid := gen_random_uuid();
  v_slug_base text;
  v_slug text;
  v_registration_type text := nullif(upper(btrim(coalesce(p_registration_type,''))), '');
  v_registration_number text := null;
begin
  if auth.uid() is null then raise exception 'Sessão inválida.' using errcode = 'P0001'; end if;

  select organization_id into v_current_org
  from public.profiles
  where id = auth.uid() and active = true;

  select account.id, account.account_type, account.status, account.billing_organization_id,
         account.organization_limit, account_user.account_role
    into v_account_id, v_account_type, v_account_status, v_billing_org, v_org_limit, v_account_role
  from public.nexus_account_organizations account_org
  join public.nexus_accounts account on account.id = account_org.account_id
  join public.nexus_account_users account_user on account_user.account_id = account.id
  where account_org.organization_id = v_current_org
    and account_org.active = true
    and account_user.user_id = auth.uid()
    and account_user.active = true
  limit 1;

  if v_account_id is null or v_account_status <> 'active' then raise exception 'Conta Nexus indisponível.' using errcode = 'P0001'; end if;
  if v_account_type <> 'consultancy' then raise exception 'Sua conta não possui gestão multiempresa.' using errcode = 'P0001'; end if;
  if v_account_role not in ('owner','manager') then raise exception 'Você não possui permissão para criar empresas nesta conta.' using errcode = 'P0001'; end if;
  if nullif(btrim(p_name), '') is null or char_length(btrim(p_name)) > 160 then raise exception 'Informe um nome de empresa válido.' using errcode = 'P0001'; end if;
  if v_registration_type is not null and v_registration_type not in ('CNPJ','CPF') then raise exception 'Tipo de documento inválido.' using errcode = 'P0001'; end if;

  if p_registration_number is not null and nullif(btrim(p_registration_number),'') is not null then
    if v_registration_type = 'CPF' then
      v_registration_number := regexp_replace(p_registration_number, '[^0-9]', '', 'g');
    else
      v_registration_number := upper(regexp_replace(p_registration_number, '[^0-9A-Za-z]', '', 'g'));
    end if;
  end if;

  if v_registration_number is not null and (
    v_registration_type is null
    or (v_registration_type = 'CPF' and v_registration_number !~ '^[0-9]{11}$')
    or (v_registration_type = 'CNPJ' and v_registration_number !~ '^[0-9A-Z]{14}$')
  ) then raise exception 'Documento da empresa inválido.' using errcode = 'P0001'; end if;

  select count(*)::integer into v_count
  from public.nexus_account_organizations
  where account_id = v_account_id and active = true;

  if v_count >= v_org_limit then raise exception 'Limite de % empresas atingido para esta conta.', v_org_limit using errcode = 'P0001'; end if;

  v_slug_base := trim(both '-' from regexp_replace(lower(btrim(p_name)), '[^a-z0-9]+', '-', 'g'));
  if v_slug_base = '' then v_slug_base := 'empresa'; end if;
  v_slug := left(v_slug_base, 52) || '-' || substr(v_new_org::text, 1, 8);

  insert into public.organizations (id,name,slug,status,trade_name,registration_type,registration_number)
  values (v_new_org,btrim(p_name),v_slug,'active',btrim(p_name),v_registration_type,v_registration_number);

  insert into public.nexus_account_organizations (account_id,organization_id,relationship_type,active)
  values (v_account_id,v_new_org,'managed',true);

  insert into public.organization_memberships (organization_id,user_id,role,active)
  select v_new_org, account_user.user_id,
         case when account_user.account_role in ('owner','manager') then 'org_admin'::public.app_role else 'viewer'::public.app_role end,
         true
  from public.nexus_account_users account_user
  where account_user.account_id = v_account_id and account_user.active = true
  on conflict (organization_id,user_id) do nothing;

  insert into public.organization_product_access (
    organization_id,product_id,access_status,subscription_status,plan_name,starts_at,renews_at,
    plan_id,contracted_price_cents,contracted_currency,billing_mode,billing_cycle_months
  )
  select v_new_org, access.product_id, access.access_status, access.subscription_status,
         'Incluído na conta multiempresa', access.starts_at, access.renews_at, access.plan_id,
         null, access.contracted_currency, access.billing_mode, access.billing_cycle_months
  from public.organization_product_access access
  where access.organization_id = v_billing_org and access.access_status = 'active'
  on conflict (organization_id,product_id) do nothing;

  insert into public.audit_logs (organization_id,user_id,action,entity,entity_id,metadata)
  values (v_new_org,auth.uid(),'CREATE_MANAGED_ORGANIZATION','organization',v_new_org::text,jsonb_build_object('account_id',v_account_id));

  return v_new_org;
end;
$$;

revoke all on function public.create_managed_organization(text,text,text) from public;
grant execute on function public.create_managed_organization(text,text,text) to authenticated;

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
  if not public.is_nexus_admin() then raise exception 'Apenas a administração Nexus pode configurar contas.' using errcode = 'P0001'; end if;
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
  set name = coalesce(nullif(btrim(p_account_name),''),name), account_type = p_account_type,
      plan_id = v_plan_id, organization_limit = p_organization_limit,
      employee_limit_total = case when p_account_type = 'consultancy' then p_employee_limit_total else null end,
      updated_at = now()
  where id = v_account_id;

  return v_account_id;
end;
$$;

revoke all on function public.configure_nexus_account(uuid,text,text,integer,integer) from public;
grant execute on function public.configure_nexus_account(uuid,text,text,integer,integer) to authenticated;

-- Mudanças na assinatura da organização de cobrança propagam estado e plano às empresas gerenciadas, nunca dados do provedor financeiro.
create or replace function public.sync_multi_company_product_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
begin
  select id into v_account_id
  from public.nexus_accounts
  where billing_organization_id = new.organization_id and account_type = 'consultancy'
  limit 1;
  if v_account_id is null then return new; end if;

  insert into public.organization_product_access (
    organization_id,product_id,access_status,subscription_status,plan_name,starts_at,renews_at,
    plan_id,contracted_price_cents,contracted_currency,billing_mode,billing_cycle_months
  )
  select account_org.organization_id,new.product_id,new.access_status,new.subscription_status,
         'Incluído na conta multiempresa',new.starts_at,new.renews_at,new.plan_id,null,new.contracted_currency,
         new.billing_mode,new.billing_cycle_months
  from public.nexus_account_organizations account_org
  where account_org.account_id = v_account_id
    and account_org.active = true
    and account_org.organization_id <> new.organization_id
  on conflict (organization_id,product_id) do update set
    access_status = excluded.access_status,
    subscription_status = excluded.subscription_status,
    plan_name = excluded.plan_name,
    starts_at = excluded.starts_at,
    renews_at = excluded.renews_at,
    plan_id = excluded.plan_id,
    contracted_price_cents = null,
    billing_mode = excluded.billing_mode,
    billing_cycle_months = excluded.billing_cycle_months,
    updated_at = now();

  return new;
end;
$$;

drop trigger if exists sync_multi_company_product_access_guard on public.organization_product_access;
create trigger sync_multi_company_product_access_guard
after insert or update of access_status,subscription_status,plan_id,starts_at,renews_at,billing_mode,billing_cycle_months
on public.organization_product_access
for each row execute function public.sync_multi_company_product_access();

-- Empresa única mantém o limite atual do plano. Consultoria usa o limite agregado configurado na conta.
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
  if coalesce(new.active,true) is not true then return new; end if;

  select account.id,account.account_type,account.employee_limit_total
    into v_account_id,v_account_type,v_account_limit
  from public.nexus_account_organizations account_org
  join public.nexus_accounts account on account.id = account_org.account_id
  where account_org.organization_id = new.organization_id and account_org.active = true and account.status = 'active'
  limit 1;

  if v_account_type = 'consultancy' then
    if v_account_limit is null then return new; end if;
    select count(*)::integer into v_active_count
    from public.employees employee
    join public.nexus_account_organizations account_org
      on account_org.organization_id = employee.organization_id
     and account_org.account_id = v_account_id
     and account_org.active = true
    where employee.active = true and (tg_op = 'INSERT' or employee.id <> new.id);
    if v_active_count >= v_account_limit then
      raise exception 'Limite total de % colaboradores ativos atingido para a conta multiempresa.',v_account_limit using errcode = 'P0001';
    end if;
    return new;
  end if;

  select plan.employee_limit into v_limit
  from public.organization_product_access access
  join public.nexus_products product on product.id = access.product_id
  left join public.nexus_plans plan on plan.id = access.plan_id
  where access.organization_id = new.organization_id and product.code = 'sst' and access.access_status = 'active'
  order by access.created_at desc limit 1;
  if v_limit is null then return new; end if;

  select count(*)::integer into v_active_count
  from public.employees employee
  where employee.organization_id = new.organization_id and employee.active = true
    and (tg_op = 'INSERT' or employee.id <> new.id);
  if v_active_count >= v_limit then
    raise exception 'Limite de % colaboradores ativos atingido para o plano contratado.',v_limit using errcode = 'P0001';
  end if;
  return new;
end;
$$;

comment on function public.switch_organization(uuid) is 'Troca a empresa ativa somente quando o usuário possui membership válida.';
comment on function public.create_managed_organization(text,text,text) is 'Cria empresa cliente dentro de conta de consultoria respeitando o limite comercial.';

commit;
