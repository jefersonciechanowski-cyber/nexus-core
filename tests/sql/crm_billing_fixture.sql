-- ONLY FOR EPHEMERAL POSTGRESQL CI. No production data, secrets, or remote resources.
-- Small schema contract to execute actual payment/trial SQL drafts against PG17.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users(id uuid primary key,email text);
CREATE TABLE public.nexus_products(
  id uuid primary key,code text not null unique,status text not null default 'active'
);
CREATE TABLE public.nexus_plans(
  id uuid primary key,product_id uuid not null references public.nexus_products(id),
  code text not null,name text,price_cents bigint,currency text,
  billing_interval_months integer,status text not null
);
CREATE TABLE public.organizations(
  id uuid primary key,registration_number text,email text,status text not null default 'active'
);
CREATE TABLE public.organization_product_access(
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  product_id uuid not null references public.nexus_products(id),
  subscription_status text not null,access_status text not null,
  renews_at date,billing_provider text,commercial_condition text,
  contracted_price_cents bigint,last_payment_status text,
  updated_at timestamptz not null default now()
);
CREATE TABLE public.nexus_sales(
  id uuid primary key,
  product_id uuid not null references public.nexus_products(id),
  plan_id uuid references public.nexus_plans(id),
  sale_status text not null,
  provider text not null,environment text not null,
  source text,billing_mode text,billing_cycle_months integer,
  checkout_amount_cents bigint,asaas_checkout_id text,asaas_subscription_id text,
  provider_subscription_id text,registration_number text,email text,
  paid_at timestamptz,organization_id uuid,user_id uuid,
  updated_at timestamptz not null default now()
);
CREATE TABLE public.nexus_payment_webhook_events(
  provider_event_id text primary key,provider text not null,
  event_type text not null,payload jsonb not null
);
CREATE TABLE public.nexus_payments(provider_payment_id text primary key);
INSERT INTO public.nexus_products(id,code,status) VALUES
('10000000-0000-4000-8000-000000000001','crm','active'),
('10000000-0000-4000-8000-000000000002','sst','active');
INSERT INTO public.nexus_plans(id,product_id,code,name,price_cents,currency,billing_interval_months,status) VALUES
('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','start','CRM Start',7900,'BRL',1,'active'),
('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','pro','CRM Pro',11900,'BRL',1,'active');
INSERT INTO public.organizations(id,registration_number,email) VALUES
('30000000-0000-4000-8000-000000000001','11111111000199','trial@example.test'),
('30000000-0000-4000-8000-000000000002','22222222000199','courtesy@example.test'),
('30000000-0000-4000-8000-000000000003','33333333000199','stripe@example.test');
INSERT INTO public.organization_product_access(
  id,organization_id,product_id,subscription_status,access_status,
  renews_at,billing_provider,commercial_condition,contracted_price_cents) VALUES
('40000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','trial','active',current_date - 1,null,'standard',0),
('40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','active','active',current_date - 1,null,'courtesy',0),
('40000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','active','active',current_date - 1,'stripe','standard',7900);
INSERT INTO public.nexus_sales(
  id,product_id,plan_id,sale_status,provider,environment,source,billing_mode,
  billing_cycle_months,checkout_amount_cents,asaas_checkout_id,registration_number,email) VALUES
('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','checkout_created','asaas','sandbox','site-captacao','recurring',1,7900,'plink_abcdef123','44444444000199','new@example.test'),
('50000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','checkout_created','asaas','sandbox','site-captacao','recurring',1,7900,'plink_second123','55555555000199','new2@example.test');
INSERT INTO public.nexus_payment_webhook_events(provider_event_id,provider,event_type,payload) VALUES
('asaas:evt_abcdef123456','asaas','PAYMENT_RECEIVED',
 '{"id":"evt_abcdef123456","event":"PAYMENT_RECEIVED","resource":{"id":"pay_abcdef123","paymentLink":"plink_abcdef123","subscription":"sub_abcdef123","billingType":"PIX","value":79}}'::jsonb),
('asaas:evt_defghi123456','asaas','PAYMENT_RECEIVED',
 '{"id":"evt_defghi123456","event":"PAYMENT_RECEIVED","resource":{"id":"pay_defghi123","paymentLink":"plink_second123","subscription":"sub_abcdef123","billingType":"PIX","value":79}}'::jsonb),
('asaas:evt_other123456','asaas','PAYMENT_RECEIVED',
 '{"id":"evt_other123456","event":"PAYMENT_RECEIVED","resource":{"id":"pay_other123","paymentLink":"plink_abcdef123","subscription":"sub_other123","billingType":"PIX","value":79}}'::jsonb);
