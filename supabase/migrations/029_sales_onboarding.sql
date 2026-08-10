begin;

alter table public.nexus_plans
  add column if not exists employee_limit integer check (employee_limit is null or employee_limit > 0),
  add column if not exists public_visible boolean not null default false,
  add column if not exists sales_badge text,
  add column if not exists sales_summary text;

-- O plano `mensal` permanece como contrato legado/testado do PR #40.
-- Novas vendas passam a usar o catálogo público abaixo, preservando o preço contratado existente.
update public.nexus_plans p
set public_visible = false, sales_badge = null, sales_summary = null, employee_limit = null, updated_at = now()
from public.nexus_products product
where p.product_id = product.id
  and product.code = 'sst'
  and p.code = 'mensal';

insert into public.nexus_plans (
  product_id, code, name, description, price_cents, currency,
  billing_interval_months, status, sort_order, employee_limit,
  public_visible, sales_badge, sales_summary
)
select
  product.id,
  'essencial',
  'Nexus SST Essencial',
  'Gestão completa de SST para operações com até 50 colaboradores ativos.',
  19700,
  'BRL',
  1,
  'active',
  10,
  50,
  true,
  null,
  'Para pequenas operações que precisam sair das planilhas e controlar vencimentos com segurança.'
from public.nexus_products product
where product.code = 'sst'
on conflict (product_id, code) do update set
  name = excluded.name,
  description = excluded.description,
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  billing_interval_months = excluded.billing_interval_months,
  status = excluded.status,
  sort_order = excluded.sort_order,
  employee_limit = excluded.employee_limit,
  public_visible = excluded.public_visible,
  sales_badge = excluded.sales_badge,
  sales_summary = excluded.sales_summary,
  updated_at = now();

insert into public.nexus_plans (
  product_id, code, name, description, price_cents, currency,
  billing_interval_months, status, sort_order, employee_limit,
  public_visible, sales_badge, sales_summary
)
select
  product.id,
  'profissional',
  'Nexus SST Profissional',
  'Gestão completa de SST para operações com até 100 colaboradores ativos.',
  19700,
  'BRL',
  1,
  'active',
  20,
  100,
  true,
  'Mais escolhido',
  'Para empresas em crescimento que precisam de visão executiva, certificados, alertas e rastreabilidade.'
from public.nexus_products product
where product.code = 'sst'
on conflict (product_id, code) do update set
  name = excluded.name,
  description = excluded.description,
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  billing_interval_months = excluded.billing_interval_months,
  status = excluded.status,
  sort_order = excluded.sort_order,
  employee_limit = excluded.employee_limit,
  public_visible = excluded.public_visible,
  sales_badge = excluded.sales_badge,
  sales_summary = excluded.sales_summary,
  updated_at = now();

insert into public.nexus_plans (
  product_id, code, name, description, price_cents, currency,
  billing_interval_months, status, sort_order, employee_limit,
  public_visible, sales_badge, sales_summary
)
select
  product.id,
  'empresarial',
  'Nexus SST Empresarial',
  'Gestão completa de SST para operações com até 250 colaboradores ativos.',
  29700,
  'BRL',
  1,
  'active',
  30,
  250,
  true,
  null,
  'Para estruturas maiores que precisam consolidar operação, documentos, ocorrências e indicadores em um único ambiente.'
from public.nexus_products product
where product.code = 'sst'
on conflict (product_id, code) do update set
  name = excluded.name,
  description = excluded.description,
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  billing_interval_months = excluded.billing_interval_months,
  status = excluded.status,
  sort_order = excluded.sort_order,
  employee_limit = excluded.employee_limit,
  public_visible = excluded.public_visible,
  sales_badge = excluded.sales_badge,
  sales_summary = excluded.sales_summary,
  updated_at = now();

insert into public.nexus_plans (
  product_id, code, name, description, price_cents, currency,
  billing_interval_months, status, sort_order, employee_limit,
  public_visible, sales_badge, sales_summary
)
select
  product.id,
  'corporativo',
  'Nexus SST Corporativo',
  'Plano para operações acima de 250 colaboradores ativos, com proposta comercial personalizada.',
  0,
  'BRL',
  1,
  'active',
  40,
  null,
  true,
  'Sob consulta',
  'Para operações acima de 250 colaboradores que exigem análise comercial antes da contratação.'
from public.nexus_products product
where product.code = 'sst'
on conflict (product_id, code) do update set
  name = excluded.name,
  description = excluded.description,
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  billing_interval_months = excluded.billing_interval_months,
  status = excluded.status,
  sort_order = excluded.sort_order,
  employee_limit = excluded.employee_limit,
  public_visible = excluded.public_visible,
  sales_badge = excluded.sales_badge,
  sales_summary = excluded.sales_summary,
  updated_at = now();

create table if not exists public.nexus_sales (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.nexus_products(id) on delete restrict,
  plan_id uuid references public.nexus_plans(id) on delete restrict,
  sale_status text not null default 'lead'
    check (sale_status in ('lead','checkout_created','paid','provisioned','expired','canceled','failed','manual_review')),
  source text not null default 'site-captacao',
  company_name text not null,
  registration_type text check (registration_type is null or registration_type in ('CNPJ','CPF')),
  registration_number text,
  responsible_name text not null,
  email text not null,
  phone text,
  employee_count integer check (employee_count is null or employee_count >= 0),
  postal_code text,
  street text,
  street_number text,
  address_complement text,
  district text,
  city text,
  state text,
  provider text not null default 'asaas' check (provider = 'asaas'),
  environment text not null default 'sandbox' check (environment in ('sandbox','production')),
  return_origin text,
  external_reference text unique,
  asaas_customer_id text,
  asaas_checkout_id text unique,
  asaas_checkout_url text,
  asaas_subscription_id text,
  organization_id uuid references public.organizations(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  last_error text,
  paid_at timestamptz,
  provisioned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint nexus_sales_registration_number_check check (
    registration_number is null
    or (registration_type = 'CNPJ' and registration_number ~ '^[0-9]{14}$')
    or (registration_type = 'CPF' and registration_number ~ '^[0-9]{11}$')
  ),
  constraint nexus_sales_state_check check (
    state is null or state in ('AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO')
  )
);

create index if not exists nexus_sales_status_idx on public.nexus_sales (sale_status, created_at desc);
create index if not exists nexus_sales_email_idx on public.nexus_sales (lower(email), created_at desc);
create index if not exists nexus_sales_registration_idx on public.nexus_sales (registration_number, created_at desc) where registration_number is not null;
create index if not exists nexus_sales_customer_idx on public.nexus_sales (asaas_customer_id) where asaas_customer_id is not null;
create index if not exists nexus_sales_subscription_idx on public.nexus_sales (asaas_subscription_id) where asaas_subscription_id is not null;

alter table public.nexus_sales enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='nexus_sales' and policyname='nexus admin read sales') then
    create policy "nexus admin read sales" on public.nexus_sales for select to authenticated using (public.is_nexus_admin());
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='nexus_sales' and policyname='nexus admin manage sales') then
    create policy "nexus admin manage sales" on public.nexus_sales for all to authenticated using (public.is_nexus_admin()) with check (public.is_nexus_admin());
  end if;
end;
$$;

grant select on public.nexus_sales to authenticated;
grant insert, update, delete on public.nexus_sales to authenticated;
grant select, insert, update, delete on public.nexus_sales to service_role;
grant select on public.nexus_products, public.nexus_plans to service_role;
grant select, insert, update on public.organizations to service_role;
grant select, insert, update on public.profiles to service_role;
grant select, insert, update on public.organization_product_access to service_role;
grant select, insert, update on public.nexus_payment_checkouts to service_role;
grant select, insert, update on public.nexus_payments to service_role;
grant select, insert on public.audit_logs to service_role;

comment on table public.nexus_sales is 'Leads e contratações iniciadas pelo site público, conciliadas com Asaas e provisionadas automaticamente no Nexus.';
comment on column public.nexus_plans.employee_limit is 'Limite comercial de colaboradores ativos para apresentação pública do plano. Null indica faixa sob consulta.';
comment on column public.nexus_plans.public_visible is 'Controla se o plano deve aparecer no site público de vendas.';
comment on column public.nexus_sales.return_origin is 'Origem web validada pela Edge Function para retorno do checkout e links de primeiro acesso.';

commit;
