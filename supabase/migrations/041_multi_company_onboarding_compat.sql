begin;

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
begin
  if new.organization_id is null then return new; end if;

  select account_org.account_id, account.account_type, account_org.relationship_type
    into v_account_id, v_account_type, v_relationship
  from public.nexus_account_organizations account_org
  join public.nexus_accounts account on account.id=account_org.account_id
  where account_org.organization_id=new.organization_id
  limit 1;

  -- Organizações criadas pelo onboarding tradicional ainda não possuem a camada de conta.
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

  -- Usuário de empresa gerenciada recebe acesso apenas àquela empresa. Ele não
  -- vira usuário da conta da consultoria automaticamente.
  if v_account_type='single_company' and v_relationship='primary' then
    insert into public.nexus_account_users (account_id,user_id,account_role,active)
    values (v_account_id,new.id,'owner',new.active)
    on conflict (account_id,user_id) do update set active=excluded.active,updated_at=now();
  end if;

  insert into public.organization_memberships (organization_id,user_id,role,active)
  values (new.organization_id,new.id,new.role,new.active)
  on conflict (organization_id,user_id) do update set role=excluded.role,active=excluded.active,updated_at=now();

  return new;
end;
$$;

drop trigger if exists profiles_nexus_account_compat_guard on public.profiles;
create trigger profiles_nexus_account_compat_guard
after insert or update of organization_id,role,active on public.profiles
for each row execute function public.ensure_nexus_account_for_profile();

create or replace function public.sync_multi_company_product_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_account_type text;
begin
  select id,account_type into v_account_id,v_account_type
  from public.nexus_accounts
  where billing_organization_id=new.organization_id
  limit 1;

  if v_account_id is null then return new; end if;

  update public.nexus_accounts
  set plan_id=new.plan_id,updated_at=now()
  where id=v_account_id and plan_id is distinct from new.plan_id;

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

comment on function public.ensure_nexus_account_for_profile() is 'Garante que novos clientes do onboarding tradicional recebam a camada de Conta Nexus e membership sem intervenção manual.';

commit;
