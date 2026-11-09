-- Ephemeral PostgreSQL 17 CI ONLY, executed after CRM SQL fixture.
-- Add only the columns needed by the real SST settlement migration.
alter table public.nexus_plans add column if not exists employee_limit integer;
alter table public.organizations
  add column if not exists name text,
  add column if not exists registration_type text,
  add column if not exists updated_at timestamptz default now();
alter table public.organization_product_access
  add column if not exists plan_name text,
  add column if not exists asaas_customer_id text,
  add column if not exists asaas_subscription_id text;
create table if not exists public.nexus_accounts (
  id uuid primary key,
  billing_organization_id uuid not null,
  account_type text not null,
  plan_id uuid,
  updated_at timestamptz not null default now()
);
create table if not exists public.employees (
  id uuid primary key,
  organization_id uuid not null,
  active boolean not null default true
);
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid,
  user_id uuid,
  action text,
  entity text,
  entity_id text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- Mirror production's uppercase CPF/CNPJ constraint. NOT VALID intentionally
-- because the inherited CRM synthetic fixture predates this registration rule;
-- Postgres still enforces it on the new SST pilot conversion UPDATE.
alter table public.organizations
  add constraint sst_fixture_organization_registration_check
  check (((registration_type IS NULL) AND (registration_number IS NULL))
    OR ((registration_type = 'CNPJ') AND (registration_number ~ '^[A-Z0-9]{12}[0-9]{2}$'))
    OR ((registration_type = 'CPF') AND (registration_number ~ '^[0-9]{11}$'))) not valid;
