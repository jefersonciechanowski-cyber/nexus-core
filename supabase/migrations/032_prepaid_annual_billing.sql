begin;

alter table public.nexus_sales
  add column if not exists billing_mode text not null default 'recurring',
  add column if not exists billing_cycle_months integer not null default 1,
  add column if not exists checkout_amount_cents bigint;

alter table public.nexus_sales
  drop constraint if exists nexus_sales_billing_mode_check;
alter table public.nexus_sales
  add constraint nexus_sales_billing_mode_check
  check (billing_mode in ('recurring','prepaid'));

alter table public.nexus_sales
  drop constraint if exists nexus_sales_billing_cycle_months_check;
alter table public.nexus_sales
  add constraint nexus_sales_billing_cycle_months_check
  check (billing_cycle_months in (1,3,6,12));

update public.nexus_sales s
set billing_cycle_months = coalesce(p.billing_interval_months, 1),
    checkout_amount_cents = coalesce(s.checkout_amount_cents, p.price_cents)
from public.nexus_plans p
where s.plan_id = p.id
  and s.billing_mode = 'recurring';

alter table public.organization_product_access
  add column if not exists billing_mode text not null default 'recurring',
  add column if not exists billing_cycle_months integer not null default 1;

alter table public.organization_product_access
  drop constraint if exists organization_product_access_billing_mode_check;
alter table public.organization_product_access
  add constraint organization_product_access_billing_mode_check
  check (billing_mode in ('recurring','prepaid'));

alter table public.organization_product_access
  drop constraint if exists organization_product_access_billing_cycle_months_check;
alter table public.organization_product_access
  add constraint organization_product_access_billing_cycle_months_check
  check (billing_cycle_months in (1,3,6,12));

update public.organization_product_access a
set billing_cycle_months = coalesce(p.billing_interval_months, 1)
from public.nexus_plans p
where a.plan_id = p.id
  and a.billing_mode = 'recurring';

comment on column public.nexus_sales.billing_mode is
  'recurring para assinatura; prepaid para período pago antecipadamente.';
comment on column public.nexus_sales.billing_cycle_months is
  'Quantidade de meses cobertos pelo valor cobrado nesta contratação.';
comment on column public.nexus_sales.checkout_amount_cents is
  'Valor efetivamente cobrado no checkout, independente do preço-base mensal do plano.';
comment on column public.organization_product_access.billing_mode is
  'Modelo comercial do acesso: recorrente ou pré-pago.';
comment on column public.organization_product_access.billing_cycle_months is
  'Quantidade de meses cobertos pelo valor contratado exibido no portal e usado no MRR.';

commit;
