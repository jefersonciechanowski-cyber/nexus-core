-- Isolated one-time real Pix acceptance pilot. Never substitute for subscriptions.
-- Applying the migration alone does not enable a charge or an entitlement.
create table if not exists public.nexus_crm_live_pix_pilot (
  id uuid primary key default gen_random_uuid(),
  slot integer not null unique default 1 check (slot = 1),
  external_reference text not null unique
    check (external_reference ~ '^nexus-crm-live-pix-r10-[0-9a-f-]{36}$'),
  created_by uuid references auth.users(id) on delete set null,
  company_name text not null check (char_length(btrim(company_name)) between 2 and 160),
  responsible_name text not null check (char_length(btrim(responsible_name)) between 2 and 160),
  email text not null check (char_length(email) <= 254),
  cpf text not null check (cpf ~ '^[0-9]{11}$'),
  plan_id uuid not null references public.nexus_plans(id) on delete restrict,
  amount_cents bigint not null default 1000 check (amount_cents = 1000),
  currency text not null default 'BRL' check (currency = 'BRL'),
  billing_type text not null default 'PIX' check (billing_type = 'PIX'),
  status text not null default 'prepared' check (status in (
    'prepared','creating_customer','creating_payment','payment_pending',
    'paid','activating','provision_pending','provisioned','manual_review'
  )),
  provider_customer_id text unique,
  provider_payment_id text unique,
  invoice_url text,
  organization_id uuid references public.organizations(id) on delete restrict,
  access_id uuid references public.organization_product_access(id) on delete restrict,
  payment_due date,
  received_at timestamptz,
  activated_at timestamptz,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.nexus_crm_live_pix_pilot is
 'One-time, owner-authorized Asaas production Pix R$10 CRM onboarding acceptance test. Server only; no subscription, no real customer shared with other products.';
alter table public.nexus_crm_live_pix_pilot enable row level security;
revoke all on table public.nexus_crm_live_pix_pilot from public, anon, authenticated;
grant select, insert, update on table public.nexus_crm_live_pix_pilot to service_role;
-- There are intentionally no anon/authenticated RLS policies.
-- slot=1 ensures that even an administrator cannot run a second live charge
-- after an ambiguous timeout or completed test without reviewed migration.
