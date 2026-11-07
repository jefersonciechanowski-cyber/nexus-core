-- Nexus CRM recurring Asaas PRODUCTION webhook store. Safe to install while
-- checkout and webhook remain HARD OFF. No live payments or tenants are touched.
begin;
create table if not exists public.nexus_crm_asaas_production_events (
  provider_event_id text primary key
    check (provider_event_id ~ '^asaas:evt_[A-Za-z0-9_&.-]{6,150}$'),
  environment text not null default 'production'
    check (environment = 'production'),
  event_type text not null
    check (event_type ~ '^(PAYMENT|SUBSCRIPTION)_[A-Z0-9_]{2,90}$'),
  resource_id text not null
    check (resource_id ~ '^(pay|sub)_[A-Za-z0-9_-]{5,120}$'),
  payload jsonb not null
    check (pg_catalog.jsonb_typeof(payload) = 'object'),
  received_at timestamptz not null default now(),
  processing_status text not null default 'pending'
    check (processing_status in ('pending','verified','manual_review','processed')),
  processed_at timestamptz,
  reason_code text
);
create index if not exists nexus_crm_asaas_prod_events_pending_idx
  on public.nexus_crm_asaas_production_events(processing_status,received_at)
  where processing_status='pending';
alter table public.nexus_crm_asaas_production_events enable row level security;
alter table public.nexus_crm_asaas_production_events force row level security;
revoke all on public.nexus_crm_asaas_production_events
  from public, anon, authenticated;
grant select, insert, update on public.nexus_crm_asaas_production_events
  to service_role;
commit;
