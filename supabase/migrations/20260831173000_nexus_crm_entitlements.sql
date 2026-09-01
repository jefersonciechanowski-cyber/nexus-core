begin;

alter table public.nexus_products
  add column if not exists launch_url text;

alter table public.nexus_products
  drop constraint if exists nexus_products_launch_url_check;

alter table public.nexus_products
  add constraint nexus_products_launch_url_check
  check (
    launch_url is null
    or launch_url like '/apps/%'
    or launch_url ~ '^https://[^[:space:]]+$'
  );

alter table public.nexus_plans
  add column if not exists included_user_limit integer;

alter table public.nexus_plans
  drop constraint if exists nexus_plans_included_user_limit_check;

alter table public.nexus_plans
  add constraint nexus_plans_included_user_limit_check
  check (included_user_limit is null or included_user_limit >= 1);

alter table public.organization_product_access
  add column if not exists commercial_condition text not null default 'standard',
  add column if not exists additional_users integer not null default 0,
  add column if not exists base_user_limit_override integer,
  add column if not exists external_tenant_id text;

alter table public.organization_product_access
  drop constraint if exists organization_product_access_commercial_condition_check,
  add constraint organization_product_access_commercial_condition_check
    check (commercial_condition in ('founder','standard')),
  drop constraint if exists organization_product_access_additional_users_check,
  add constraint organization_product_access_additional_users_check
    check (additional_users >= 0),
  drop constraint if exists organization_product_access_base_user_limit_override_check,
  add constraint organization_product_access_base_user_limit_override_check
    check (base_user_limit_override is null or base_user_limit_override >= 1),
  drop constraint if exists organization_product_access_external_tenant_id_length_check,
  add constraint organization_product_access_external_tenant_id_length_check
    check (external_tenant_id is null or char_length(btrim(external_tenant_id)) between 1 and 240);

create unique index if not exists organization_product_access_external_tenant_uidx
  on public.organization_product_access (product_id, external_tenant_id)
  where external_tenant_id is not null;

insert into public.nexus_products (
  code,
  name,
  description,
  app_path,
  launch_url,
  status,
  sort_order
) values (
  'crm',
  'Nexus CRM',
  'CRM comercial com captação, atendimento conectado, Lead 360° e gestão de funil.',
  '/apps/crm/',
  'https://nexus-crm-tau-three.vercel.app/',
  'active',
  20
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  launch_url = excluded.launch_url,
  status = excluded.status,
  sort_order = excluded.sort_order,
  updated_at = now();

insert into public.nexus_plans (
  product_id,
  code,
  name,
  description,
  price_cents,
  currency,
  billing_interval_months,
  status,
  sort_order,
  public_visible,
  sales_badge,
  sales_summary,
  included_user_limit
)
select
  product.id,
  plan.code,
  plan.name,
  plan.description,
  plan.price_cents,
  'BRL',
  1,
  'active',
  plan.sort_order,
  false,
  plan.sales_badge,
  plan.sales_summary,
  plan.included_user_limit
from public.nexus_products product
cross join (
  values
    ('start'::text, 'Nexus CRM Start'::text, 'Todas as funcionalidades e integrações do Nexus CRM para equipes de até 3 usuários.'::text, 7900::bigint, 10::integer, null::text, 'Entrada enxuta para validar o processo comercial com a equipe.'::text, 3::integer),
    ('pro'::text, 'Nexus CRM Pro'::text, 'Todas as funcionalidades e integrações do Nexus CRM para equipes de até 6 usuários.'::text, 11900::bigint, 20::integer, 'Mais escolhido'::text, 'Para equipes comerciais em crescimento que precisam de mais usuários no mesmo processo.'::text, 6::integer),
    ('gestao'::text, 'Nexus CRM Gestão'::text, 'Todas as funcionalidades e integrações do Nexus CRM para equipes de até 10 usuários.'::text, 15900::bigint, 30::integer, null::text, 'Para operações com gestão comercial e uma equipe maior dentro do CRM.'::text, 10::integer),
    ('custom'::text, 'Nexus CRM Personalizado'::text, 'Plano com preço e limite de usuários definidos comercialmente pela Nexus Core.'::text, 0::bigint, 40::integer, 'Sob consulta'::text, 'Condição personalizada para operações que exigem composição comercial específica.'::text, 1::integer)
) as plan(code, name, description, price_cents, sort_order, sales_badge, sales_summary, included_user_limit)
where product.code = 'crm'
on conflict (product_id, code) do update set
  name = excluded.name,
  description = excluded.description,
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  billing_interval_months = excluded.billing_interval_months,
  status = excluded.status,
  sort_order = excluded.sort_order,
  sales_badge = excluded.sales_badge,
  sales_summary = excluded.sales_summary,
  included_user_limit = excluded.included_user_limit,
  updated_at = now();

create or replace function public.configure_crm_product_access(
  p_organization_id uuid,
  p_crm_organization_id uuid,
  p_plan_code text,
  p_access_status text default 'active',
  p_subscription_status text default 'active',
  p_commercial_condition text default 'standard',
  p_additional_users integer default 0,
  p_base_user_limit_override integer default null,
  p_contracted_price_cents bigint default null,
  p_starts_at date default current_date,
  p_renews_at date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid;
  v_plan_id uuid;
  v_plan_name text;
  v_plan_price bigint;
  v_access_id uuid;
begin
  if not public.is_nexus_admin() then
    raise exception 'Apenas a administração Nexus pode configurar o Nexus CRM.' using errcode = 'P0001';
  end if;

  if p_access_status not in ('active','suspended') then
    raise exception 'Status de acesso inválido.' using errcode = 'P0001';
  end if;

  if p_subscription_status not in ('legacy','trial','active','past_due','cancelled') then
    raise exception 'Status da assinatura inválido.' using errcode = 'P0001';
  end if;

  if p_commercial_condition not in ('founder','standard') then
    raise exception 'Condição comercial inválida.' using errcode = 'P0001';
  end if;

  if p_additional_users is null or p_additional_users < 0 then
    raise exception 'Quantidade de usuários adicionais inválida.' using errcode = 'P0001';
  end if;

  if p_base_user_limit_override is not null and p_base_user_limit_override < 1 then
    raise exception 'Limite-base de usuários inválido.' using errcode = 'P0001';
  end if;

  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'Empresa da Central Nexus não encontrada.' using errcode = 'P0001';
  end if;

  select id into v_product_id
  from public.nexus_products
  where code = 'crm' and status = 'active'
  limit 1;

  if v_product_id is null then
    raise exception 'Produto Nexus CRM não encontrado.' using errcode = 'P0001';
  end if;

  select id, name, price_cents
    into v_plan_id, v_plan_name, v_plan_price
  from public.nexus_plans
  where product_id = v_product_id
    and code = lower(btrim(p_plan_code))
    and status = 'active'
  limit 1;

  if v_plan_id is null then
    raise exception 'Plano do Nexus CRM não encontrado.' using errcode = 'P0001';
  end if;

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
    commercial_condition,
    additional_users,
    base_user_limit_override,
    external_tenant_id,
    updated_at
  ) values (
    p_organization_id,
    v_product_id,
    p_access_status,
    p_subscription_status,
    v_plan_name,
    p_starts_at,
    p_renews_at,
    v_plan_id,
    coalesce(p_contracted_price_cents, v_plan_price),
    'BRL',
    p_commercial_condition,
    p_additional_users,
    p_base_user_limit_override,
    p_crm_organization_id::text,
    now()
  )
  on conflict (organization_id, product_id) do update set
    access_status = excluded.access_status,
    subscription_status = excluded.subscription_status,
    plan_name = excluded.plan_name,
    starts_at = excluded.starts_at,
    renews_at = excluded.renews_at,
    plan_id = excluded.plan_id,
    contracted_price_cents = excluded.contracted_price_cents,
    contracted_currency = excluded.contracted_currency,
    commercial_condition = excluded.commercial_condition,
    additional_users = excluded.additional_users,
    base_user_limit_override = excluded.base_user_limit_override,
    external_tenant_id = excluded.external_tenant_id,
    updated_at = now()
  returning id into v_access_id;

  return v_access_id;
end;
$$;

revoke all on function public.configure_crm_product_access(uuid,uuid,text,text,text,text,integer,integer,bigint,date,date)
  from public, anon;
grant execute on function public.configure_crm_product_access(uuid,uuid,text,text,text,text,integer,integer,bigint,date,date)
  to authenticated;

comment on column public.nexus_products.launch_url is
  'URL de abertura do produto quando o sistema está hospedado fora do monorepo. app_path permanece como fallback interno.';
comment on column public.nexus_plans.included_user_limit is
  'Quantidade de usuários incluídos no preço-base para produtos cobrados por assentos. Null quando não se aplica.';
comment on column public.organization_product_access.external_tenant_id is
  'Identificador do tenant correspondente no produto de destino. No Nexus CRM contém o organization_id do CRM.';
comment on column public.organization_product_access.commercial_condition is
  'Condição comercial preservada no contrato, incluindo founder ou standard.';
comment on column public.organization_product_access.additional_users is
  'Assentos adicionais contratados além do limite-base do plano.';
comment on column public.organization_product_access.base_user_limit_override is
  'Override administrativo do limite-base de usuários. Quando null, usa included_user_limit do plano.';
comment on function public.configure_crm_product_access(uuid,uuid,text,text,text,text,integer,integer,bigint,date,date) is
  'Configura o acesso comercial do Nexus CRM na Central e registra o tenant correspondente no CRM.';

commit;
