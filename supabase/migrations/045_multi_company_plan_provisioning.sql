begin;

alter table public.nexus_accounts
  add column if not exists configuration_source text not null default 'plan';

alter table public.nexus_accounts
  drop constraint if exists nexus_accounts_configuration_source_check,
  add constraint nexus_accounts_configuration_source_check
    check (configuration_source in ('plan','manual'));

-- Configuração explícita pela Central Nexus passa a prevalecer sobre defaults do plano.
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

revoke all on function public.configure_nexus_account(uuid,text,text,integer,integer) from public, anon;
grant execute on function public.configure_nexus_account(uuid,text,text,integer,integer) to authenticated;

-- Quando o acesso comercial é criado/alterado pelo checkout, a conta recebe os
-- defaults do plano somente se não houver override administrativo manual.
create or replace function public.sync_multi_company_product_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_account_type text;
  v_configuration_source text;
  v_plan_customer_type text;
  v_plan_organization_limit integer;
  v_plan_employee_scope text;
  v_plan_employee_limit integer;
begin
  select id,account_type,configuration_source
    into v_account_id,v_account_type,v_configuration_source
  from public.nexus_accounts
  where billing_organization_id=new.organization_id
  limit 1;

  if v_account_id is null then return new; end if;

  select customer_type,organization_limit,employee_limit_scope,employee_limit
    into v_plan_customer_type,v_plan_organization_limit,v_plan_employee_scope,v_plan_employee_limit
  from public.nexus_plans
  where id=new.plan_id;

  if v_configuration_source='plan' and v_plan_customer_type is not null then
    update public.nexus_accounts
    set plan_id=new.plan_id,
        account_type=v_plan_customer_type,
        organization_limit=case when v_plan_customer_type='consultancy' then greatest(1,coalesce(v_plan_organization_limit,1)) else 1 end,
        employee_limit_total=case
          when v_plan_customer_type='consultancy' and v_plan_employee_scope='account' then v_plan_employee_limit
          else null
        end,
        updated_at=now()
    where id=v_account_id;

    v_account_type:=v_plan_customer_type;
  else
    update public.nexus_accounts
    set plan_id=new.plan_id,updated_at=now()
    where id=v_account_id and plan_id is distinct from new.plan_id;
  end if;

  if v_account_type<>'consultancy' then return new; end if;

  insert into public.organization_product_access (
    organization_id,product_id,access_status,subscription_status,plan_name,starts_at,renews_at,
    plan_id,contracted_price_cents,contracted_currency,billing_mode,billing_cycle_months
  )
  select account_org.organization_id,new.product_id,new.access_status,new.subscription_status,
         'Incluído na conta multiempresa',new.starts_at,new.renews_at,new.plan_id,null,new.contracted_currency,
         new.billing_mode,new.billing_cycle_months
  from public.nexus_account_organizations account_org
  where account_org.account_id=v_account_id
    and account_org.active=true
    and account_org.organization_id<>new.organization_id
  on conflict (organization_id,product_id) do update set
    access_status=excluded.access_status,
    subscription_status=excluded.subscription_status,
    plan_name=excluded.plan_name,
    starts_at=excluded.starts_at,
    renews_at=excluded.renews_at,
    plan_id=excluded.plan_id,
    contracted_price_cents=null,
    billing_mode=excluded.billing_mode,
    billing_cycle_months=excluded.billing_cycle_months,
    updated_at=now();

  return new;
end;
$$;

revoke all on function public.sync_multi_company_product_access() from public, anon, authenticated;

comment on column public.nexus_accounts.configuration_source is 'plan: segue defaults comerciais do plano; manual: configuração explícita da Central Nexus prevalece.';
comment on function public.sync_multi_company_product_access() is 'Sincroniza plano/acesso e provisiona automaticamente o modelo multiempresa quando o plano comercial definir consultoria.';

commit;
