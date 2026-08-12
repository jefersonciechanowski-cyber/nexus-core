begin;

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
  select
    v_new_org,
    account_user.user_id,
    case
      when billing_membership.role = 'nexus_admin'::public.app_role then 'nexus_admin'::public.app_role
      when account_user.account_role in ('owner','manager') then 'org_admin'::public.app_role
      else 'viewer'::public.app_role
    end,
    true
  from public.nexus_account_users account_user
  left join public.organization_memberships billing_membership
    on billing_membership.organization_id = v_billing_org
   and billing_membership.user_id = account_user.user_id
   and billing_membership.active = true
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

revoke all on function public.create_managed_organization(text,text,text) from public, anon;
grant execute on function public.create_managed_organization(text,text,text) to authenticated;

comment on function public.create_managed_organization(text,text,text) is 'Cria empresa gerenciada; preserva nexus_admin global e concede org_admin apenas a owner/manager comuns.';

commit;
