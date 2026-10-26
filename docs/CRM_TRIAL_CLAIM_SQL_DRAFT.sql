-- REVIEW ONLY: Do not apply to production. Trial grants are OFF by default.
-- Convert to a Supabase CLI migration and exercise on an isolated test database.
-- This table prevents two trial grants for the same email OR document even
-- when simultaneous administrative requests are made.
create table if not exists public.nexus_crm_trial_claims (
  id uuid primary key,
  email_fingerprint text not null unique,
  document_fingerprint text not null unique,
  trial_days integer not null check (trial_days in (15,30)),
  organization_id uuid null references public.organizations(id),
  access_id uuid null references public.organization_product_access(id),
  state text not null default 'reserved'
    check (state in ('reserved','provisioned','manual_review')),
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint trial_claim_email_hash_valid check (email_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint trial_claim_document_hash_valid check (document_fingerprint ~ '^[0-9a-f]{64}$')
);
create unique index if not exists nexus_crm_trial_claim_access_unique
  on public.nexus_crm_trial_claims(access_id) where access_id is not null;
alter table public.nexus_crm_trial_claims enable row level security;
revoke all on public.nexus_crm_trial_claims from PUBLIC,anon,authenticated;

create or replace function public.reserve_nexus_crm_trial(
  p_id uuid,p_email_fingerprint text,p_document_fingerprint text,p_trial_days integer
) returns boolean
language plpgsql security definer set search_path=''
as $$
begin
  if p_id is null or p_trial_days not in (15,30)
    or p_email_fingerprint !~ '^[0-9a-f]{64}$'
    or p_document_fingerprint !~ '^[0-9a-f]{64}$' then return false; end if;
  insert into public.nexus_crm_trial_claims(id,email_fingerprint,document_fingerprint,trial_days)
    values(p_id,p_email_fingerprint,p_document_fingerprint,p_trial_days)
    on conflict do nothing;
  return found;
end; $$;
revoke all on function public.reserve_nexus_crm_trial(uuid,text,text,integer)
  from PUBLIC,anon,authenticated;
grant execute on function public.reserve_nexus_crm_trial(uuid,text,text,integer)
  to service_role;

-- Only mark completed when the CRM confirms the entitlement and tenant.
-- No privilege to change existing courtesy, founder or paid subscriptions.
create or replace function public.confirm_nexus_crm_trial(
  p_id uuid,p_organization_id uuid,p_access_id uuid
) returns boolean
language plpgsql security definer set search_path=''
as $$
declare v_claim public.nexus_crm_trial_claims%rowtype;
begin
  select * into v_claim from public.nexus_crm_trial_claims where id=p_id for update;
  if not found or v_claim.state <> 'reserved' then return false; end if;
  if not exists (
    select 1 from public.organization_product_access a
      join public.nexus_products p on p.id=a.product_id
    where a.id=p_access_id and a.organization_id=p_organization_id
      and p.code='crm' and a.subscription_status='trial'
      and a.commercial_condition='standard'
      and a.billing_provider is null and a.contracted_price_cents=0
  ) then return false; end if;
  update public.nexus_crm_trial_claims set state='provisioned',
    organization_id=p_organization_id,access_id=p_access_id,updated_at=pg_catalog.now()
    where id=p_id and state='reserved';
  return found;
end; $$;
revoke all on function public.confirm_nexus_crm_trial(uuid,uuid,uuid)
  from PUBLIC,anon,authenticated;
grant execute on function public.confirm_nexus_crm_trial(uuid,uuid,uuid)
  to service_role;
-- Intentionally NO DELETE or RESET function: reuse only via audited manual review.
