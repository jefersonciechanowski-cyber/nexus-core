begin;

create or replace function public.provision_nexus_pilot(
  p_user_id uuid,
  p_created_by uuid,
  p_company_name text,
  p_responsible_name text,
  p_email text,
  p_phone text default null,
  p_days integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
  v_plan_id uuid;
  v_organization_id uuid := gen_random_uuid();
  v_account_id uuid := gen_random_uuid();
  v_access_id uuid := gen_random_uuid();
  v_slug_base text;
  v_slug text;
  v_valid_until date;
  v_existing_profile uuid;
begin
  if p_user_id is null or p_created_by is null then
    raise exception 'Usuário do piloto ou administrador não informado.' using errcode = 'P0001';
  end if;

  if nullif(btrim(coalesce(p_company_name, '')), '') is null or char_length(btrim(p_company_name)) > 160 then
    raise exception 'Informe um nome de empresa válido.' using errcode = 'P0001';
  end if;

  if nullif(btrim(coalesce(p_responsible_name, '')), '') is null or char_length(btrim(p_responsible_name)) > 160 then
    raise exception 'Informe o nome do responsável.' using errcode = 'P0001';
  end if;

  if nullif(btrim(coalesce(p_email, '')), '') is null or char_length(btrim(p_email)) > 255 then
    raise exception 'Informe um e-mail válido.' using errcode = 'P0001';
  end if;

  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'A duração do piloto deve ficar entre 1 e 90 dias.' using errcode = 'P0001';
  end if;

  if not exists (
    select 1 from public.profiles
    where id = p_created_by and role = 'nexus_admin'::public.app_role and active = true
  ) then
    raise exception 'Apenas a administração Nexus pode provisionar acessos piloto.' using errcode = 'P0001';
  end if;

  select id into v_existing_profile
  from public.profiles
  where id = p_user_id
  limit 1;

  if v_existing_profile is not null then
    raise exception 'Este usuário já possui um perfil Nexus.' using errcode = 'P0001';
  end if;

  select product.id, plan.id
    into v_product_id, v_plan_id
  from public.nexus_products product
  join public.nexus_plans plan on plan.product_id = product.id
  where product.code = 'sst'
    and product.status = 'active'
    and plan.code = 'piloto'
    and plan.status = 'active'
  limit 1;

  if v_product_id is null or v_plan_id is null then
    raise exception 'Plano piloto do Nexus SST não está disponível.' using errcode = 'P0001';
  end if;

  v_slug_base := trim(both '-' from regexp_replace(lower(btrim(p_company_name)), '[^a-z0-9]+', '-', 'g'));
  if v_slug_base = '' then v_slug_base := 'piloto'; end if;
  v_slug := left(v_slug_base, 48) || '-pilot-' || substr(v_organization_id::text, 1, 8);
  v_valid_until := current_date + p_days;

  insert into public.organizations (
    id, name, slug, status, legal_name, trade_name, email, phone, legal_responsible_name
  ) values (
    v_organization_id,
    btrim(p_company_name),
    v_slug,
    'active',
    btrim(p_company_name),
    btrim(p_company_name),
    lower(btrim(p_email)),
    nullif(btrim(coalesce(p_phone, '')), ''),
    btrim(p_responsible_name)
  );

  -- A conta precisa existir antes do perfil. O trigger de compatibilidade de profiles
  -- detecta a conta existente e apenas completa usuário/membership, evitando duplicidade.
  insert into public.nexus_accounts (
    id, name, account_type, status, billing_organization_id, plan_id,
    organization_limit, employee_limit_total, created_by, configuration_source
  ) values (
    v_account_id, btrim(p_company_name), 'single_company', 'active', v_organization_id, v_plan_id,
    1, null, p_created_by, 'plan'
  );

  insert into public.nexus_account_organizations (account_id, organization_id, relationship_type, active)
  values (v_account_id, v_organization_id, 'primary', true);

  insert into public.profiles (id, organization_id, full_name, role, active)
  values (p_user_id, v_organization_id, btrim(p_responsible_name), 'org_admin'::public.app_role, true);

  insert into public.organization_product_access (
    id, organization_id, product_id, access_status, subscription_status, plan_name,
    starts_at, renews_at, plan_id, contracted_price_cents, contracted_currency,
    billing_provider, provider_customer_id, provider_subscription_id,
    billing_mode, billing_cycle_months
  ) values (
    v_access_id, v_organization_id, v_product_id, 'active', 'trial', 'Nexus SST Piloto',
    current_date, v_valid_until, v_plan_id, 0, 'BRL',
    null, null, null,
    'prepaid', 1
  );

  insert into public.audit_logs (organization_id, user_id, action, entity, entity_id, metadata)
  values (
    v_organization_id,
    p_created_by,
    'NEXUS_PILOT_CREATED',
    'organization_product_access',
    v_access_id::text,
    jsonb_build_object(
      'pilot_user_id', p_user_id,
      'email', lower(btrim(p_email)),
      'days', p_days,
      'valid_until', v_valid_until,
      'plan_id', v_plan_id
    )
  );

  return jsonb_build_object(
    'organizationId', v_organization_id,
    'accountId', v_account_id,
    'accessId', v_access_id,
    'planId', v_plan_id,
    'validUntil', v_valid_until
  );
end;
$$;

revoke all on function public.provision_nexus_pilot(uuid,uuid,text,text,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.provision_nexus_pilot(uuid,uuid,text,text,text,text,integer)
  to service_role;

commit;
