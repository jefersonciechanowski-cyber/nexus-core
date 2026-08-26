begin;

-- Torna o catálogo da Central Nexus apto a representar produtos locais e
-- produtos hospedados fora do repositório principal, como o Nexus CRM.
alter table public.nexus_products
  alter column app_path drop not null;

alter table public.nexus_products
  drop constraint if exists nexus_products_app_path_check;

alter table public.nexus_products
  add constraint nexus_products_app_path_check
  check (app_path is null or app_path like '/apps/%');

alter table public.nexus_products
  add column if not exists launch_url text,
  add column if not exists sales_enabled boolean not null default true,
  add column if not exists provisioning_mode text not null default 'core';

alter table public.nexus_products
  drop constraint if exists nexus_products_launch_url_check;
alter table public.nexus_products
  add constraint nexus_products_launch_url_check
  check (launch_url is null or launch_url ~ '^https://');

alter table public.nexus_products
  drop constraint if exists nexus_products_provisioning_mode_check;
alter table public.nexus_products
  add constraint nexus_products_provisioning_mode_check
  check (provisioning_mode in ('core','external'));

-- employee_limit continua válido para o SST. seat_limit passa a representar
-- licenças/usuários de produtos como o CRM sem misturar as duas métricas.
alter table public.nexus_plans
  add column if not exists seat_limit integer
    check (seat_limit is null or seat_limit > 0);

-- Captura a quantidade de licenças solicitadas em vendas de produtos que
-- trabalham por usuário. Mantém employee_count para compatibilidade com SST.
alter table public.nexus_sales
  add column if not exists seat_count integer
    check (seat_count is null or seat_count >= 0);

-- Estado de provisionamento de produtos externos. A assinatura comercial e o
-- tenant operacional permanecem desacoplados e auditáveis.
alter table public.organization_product_access
  add column if not exists provisioning_status text not null default 'not_required',
  add column if not exists external_tenant_id text,
  add column if not exists external_launch_url text,
  add column if not exists provisioned_at timestamptz,
  add column if not exists provisioning_error text;

alter table public.organization_product_access
  drop constraint if exists organization_product_access_provisioning_status_check;
alter table public.organization_product_access
  add constraint organization_product_access_provisioning_status_check
  check (provisioning_status in ('not_required','pending','provisioned','failed'));

alter table public.organization_product_access
  drop constraint if exists organization_product_access_external_launch_url_check;
alter table public.organization_product_access
  add constraint organization_product_access_external_launch_url_check
  check (external_launch_url is null or external_launch_url ~ '^https://');

create table if not exists public.nexus_product_provisioning_jobs (
  id uuid primary key default gen_random_uuid(),
  access_id uuid not null references public.organization_product_access(id) on delete cascade,
  product_id uuid not null references public.nexus_products(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_status text not null default 'pending'
    check (job_status in ('pending','processing','succeeded','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  next_attempt_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (access_id)
);

create index if not exists nexus_product_provisioning_jobs_pending_idx
  on public.nexus_product_provisioning_jobs (job_status, next_attempt_at, created_at)
  where job_status in ('pending','failed');

alter table public.nexus_product_provisioning_jobs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='nexus_product_provisioning_jobs'
      and policyname='nexus admin read provisioning jobs'
  ) then
    create policy "nexus admin read provisioning jobs"
      on public.nexus_product_provisioning_jobs
      for select to authenticated
      using (public.is_nexus_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='nexus_product_provisioning_jobs'
      and policyname='nexus admin manage provisioning jobs'
  ) then
    create policy "nexus admin manage provisioning jobs"
      on public.nexus_product_provisioning_jobs
      for all to authenticated
      using (public.is_nexus_admin())
      with check (public.is_nexus_admin());
  end if;
end;
$$;

grant select, insert, update, delete on public.nexus_product_provisioning_jobs to authenticated;
grant select, insert, update, delete on public.nexus_product_provisioning_jobs to service_role;
grant update (
  provisioning_status,
  external_tenant_id,
  external_launch_url,
  provisioned_at,
  provisioning_error,
  updated_at
) on public.organization_product_access to service_role;

create or replace function public.queue_external_product_provisioning()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
begin
  select provisioning_mode into v_mode
  from public.nexus_products
  where id = new.product_id;

  if v_mode <> 'external' then
    if new.provisioning_status <> 'not_required' then
      update public.organization_product_access
      set provisioning_status = 'not_required',
          provisioning_error = null,
          updated_at = now()
      where id = new.id;
    end if;
    return new;
  end if;

  if new.access_status = 'active'
     and new.subscription_status in ('active','trial','legacy') then
    insert into public.nexus_product_provisioning_jobs (
      access_id, product_id, organization_id, job_status, next_attempt_at, updated_at
    ) values (
      new.id, new.product_id, new.organization_id, 'pending', now(), now()
    )
    on conflict (access_id) do update set
      product_id = excluded.product_id,
      organization_id = excluded.organization_id,
      job_status = case
        when public.nexus_product_provisioning_jobs.job_status = 'succeeded'
          then public.nexus_product_provisioning_jobs.job_status
        else 'pending'
      end,
      next_attempt_at = now(),
      updated_at = now();

    if new.provisioning_status not in ('provisioned','pending') then
      update public.organization_product_access
      set provisioning_status = 'pending',
          provisioning_error = null,
          updated_at = now()
      where id = new.id;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.queue_external_product_provisioning() from public;
grant execute on function public.queue_external_product_provisioning() to service_role;

drop trigger if exists trg_queue_external_product_provisioning
  on public.organization_product_access;
create trigger trg_queue_external_product_provisioning
after insert or update of access_status, subscription_status, product_id
on public.organization_product_access
for each row execute function public.queue_external_product_provisioning();

-- Produto oficial Nexus CRM. Vendas públicas ficam bloqueadas até que URL de
-- publicação e endpoint de provisionamento do CRM sejam configurados.
insert into public.nexus_products (
  code,
  name,
  description,
  app_path,
  launch_url,
  status,
  sort_order,
  sales_enabled,
  provisioning_mode
) values (
  'crm',
  'Nexus CRM',
  'Gestão comercial de leads, contatos, atendimento, funis, oportunidades e clientes.',
  null,
  null,
  'active',
  20,
  false,
  'external'
)
on conflict (code) do update set
  name = excluded.name,
  description = excluded.description,
  status = excluded.status,
  sort_order = excluded.sort_order,
  provisioning_mode = excluded.provisioning_mode,
  updated_at = now();

-- Catálogo comercial acordado para lançamento do Nexus CRM.
insert into public.nexus_plans (
  product_id, code, name, description, price_cents, currency,
  billing_interval_months, status, sort_order, employee_limit, seat_limit,
  public_visible, sales_badge, sales_summary
)
select product.id, 'essencial', 'Nexus CRM Essencial',
  'CRM comercial para pequenas equipes, com gestão de leads, contatos e funil de vendas.',
  14900, 'BRL', 1, 'active', 10, null, 3, true, null,
  'Para pequenas equipes que precisam organizar leads, contatos e negociações em um único processo.'
from public.nexus_products product where product.code='crm'
on conflict (product_id, code) do update set
  name=excluded.name, description=excluded.description, price_cents=excluded.price_cents,
  currency=excluded.currency, billing_interval_months=excluded.billing_interval_months,
  status=excluded.status, sort_order=excluded.sort_order, employee_limit=null,
  seat_limit=excluded.seat_limit, public_visible=excluded.public_visible,
  sales_badge=excluded.sales_badge, sales_summary=excluded.sales_summary, updated_at=now();

insert into public.nexus_plans (
  product_id, code, name, description, price_cents, currency,
  billing_interval_months, status, sort_order, employee_limit, seat_limit,
  public_visible, sales_badge, sales_summary
)
select product.id, 'profissional', 'Nexus CRM Profissional',
  'Operação comercial estruturada com atendimento, múltiplos funis, propostas, campos e gestão de equipe.',
  34900, 'BRL', 1, 'active', 20, null, 5, true, 'Mais escolhido',
  'Para empresas que precisam transformar o processo comercial em uma operação previsível e acompanhável.'
from public.nexus_products product where product.code='crm'
on conflict (product_id, code) do update set
  name=excluded.name, description=excluded.description, price_cents=excluded.price_cents,
  currency=excluded.currency, billing_interval_months=excluded.billing_interval_months,
  status=excluded.status, sort_order=excluded.sort_order, employee_limit=null,
  seat_limit=excluded.seat_limit, public_visible=excluded.public_visible,
  sales_badge=excluded.sales_badge, sales_summary=excluded.sales_summary, updated_at=now();

insert into public.nexus_plans (
  product_id, code, name, description, price_cents, currency,
  billing_interval_months, status, sort_order, employee_limit, seat_limit,
  public_visible, sales_badge, sales_summary
)
select product.id, 'performance', 'Nexus CRM Performance',
  'Gestão comercial para equipes maiores, com recursos avançados, integrações e expansão de usuários.',
  69900, 'BRL', 1, 'active', 30, null, 10, true, null,
  'Para operações comerciais que precisam de mais usuários, governança e capacidade de evolução.'
from public.nexus_products product where product.code='crm'
on conflict (product_id, code) do update set
  name=excluded.name, description=excluded.description, price_cents=excluded.price_cents,
  currency=excluded.currency, billing_interval_months=excluded.billing_interval_months,
  status=excluded.status, sort_order=excluded.sort_order, employee_limit=null,
  seat_limit=excluded.seat_limit, public_visible=excluded.public_visible,
  sales_badge=excluded.sales_badge, sales_summary=excluded.sales_summary, updated_at=now();

comment on column public.nexus_products.launch_url is
  'URL pública de abertura do produto quando ele é hospedado fora do Nexus Core principal.';
comment on column public.nexus_products.sales_enabled is
  'Chave de segurança comercial. Checkout público só deve ser habilitado após publicação e provisionamento estarem operacionais.';
comment on column public.nexus_products.provisioning_mode is
  'core usa o ambiente operacional do próprio Nexus Core; external exige criação de tenant em outro produto.';
comment on column public.nexus_plans.seat_limit is
  'Quantidade de usuários/licenças incluídas no plano para produtos com cobrança por equipe.';
comment on table public.nexus_product_provisioning_jobs is
  'Fila idempotente para provisionamento de tenants em produtos Nexus hospedados externamente.';

commit;
