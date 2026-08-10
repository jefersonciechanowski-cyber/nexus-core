begin;

-- PR #41: Stripe passa a ser o provedor padrão para novas contratações.
-- O histórico Asaas permanece íntegro e consultável.

alter table public.nexus_sales
  drop constraint if exists nexus_sales_provider_check;
alter table public.nexus_sales
  add constraint nexus_sales_provider_check check (provider in ('asaas','stripe'));
alter table public.nexus_sales alter column provider set default 'stripe';

alter table public.nexus_sales
  add column if not exists provider_customer_id text,
  add column if not exists provider_checkout_id text,
  add column if not exists provider_checkout_url text,
  add column if not exists provider_subscription_id text;

update public.nexus_sales
set provider_customer_id = coalesce(provider_customer_id, asaas_customer_id),
    provider_checkout_id = coalesce(provider_checkout_id, asaas_checkout_id),
    provider_checkout_url = coalesce(provider_checkout_url, asaas_checkout_url),
    provider_subscription_id = coalesce(provider_subscription_id, asaas_subscription_id)
where provider = 'asaas';

create unique index if not exists nexus_sales_provider_checkout_uidx
  on public.nexus_sales(provider, provider_checkout_id)
  where provider_checkout_id is not null;
create index if not exists nexus_sales_provider_customer_idx
  on public.nexus_sales(provider, provider_customer_id)
  where provider_customer_id is not null;
create index if not exists nexus_sales_provider_subscription_idx
  on public.nexus_sales(provider, provider_subscription_id)
  where provider_subscription_id is not null;

alter table public.organization_product_access
  add column if not exists billing_provider text check (billing_provider is null or billing_provider in ('asaas','stripe')),
  add column if not exists provider_customer_id text,
  add column if not exists provider_subscription_id text;

update public.organization_product_access
set billing_provider = coalesce(billing_provider, 'asaas'),
    provider_customer_id = coalesce(provider_customer_id, asaas_customer_id),
    provider_subscription_id = coalesce(provider_subscription_id, asaas_subscription_id)
where asaas_customer_id is not null or asaas_subscription_id is not null;

create index if not exists organization_product_access_provider_customer_idx
  on public.organization_product_access(billing_provider, provider_customer_id)
  where provider_customer_id is not null;
create index if not exists organization_product_access_provider_subscription_idx
  on public.organization_product_access(billing_provider, provider_subscription_id)
  where provider_subscription_id is not null;

alter table public.nexus_payment_checkouts
  drop constraint if exists nexus_payment_checkouts_provider_check;
alter table public.nexus_payment_checkouts
  add constraint nexus_payment_checkouts_provider_check check (provider in ('asaas','stripe'));
alter table public.nexus_payment_checkouts alter column provider set default 'stripe';

alter table public.nexus_payments
  drop constraint if exists nexus_payments_provider_check;
alter table public.nexus_payments
  add constraint nexus_payments_provider_check check (provider in ('asaas','stripe'));
alter table public.nexus_payments alter column provider set default 'stripe';

alter table public.nexus_payment_webhook_events
  drop constraint if exists nexus_payment_webhook_events_provider_check;
alter table public.nexus_payment_webhook_events
  add constraint nexus_payment_webhook_events_provider_check check (provider in ('asaas','stripe'));
alter table public.nexus_payment_webhook_events alter column provider set default 'stripe';

comment on table public.nexus_sales is
  'Leads e contratações iniciadas pelo site público, conciliadas com o provedor de pagamento e provisionadas automaticamente no Nexus.';
comment on table public.nexus_payment_checkouts is
  'Jornadas de checkout hospedado para assinaturas Nexus. Escrita reservada ao backend service_role.';
comment on table public.nexus_payments is
  'Cobranças e recebimentos reconciliados por webhook do provedor de pagamento. Escrita reservada ao backend service_role.';
comment on table public.nexus_payment_webhook_events is
  'Eventos financeiros persistidos para idempotência e auditoria. Escrita reservada ao backend service_role.';
comment on column public.organization_product_access.billing_provider is
  'Provedor responsável pela assinatura comercial atual. Null preserva acessos sem cobrança integrada.';

commit;
