-- REVIEW-ONLY: DO NOT APPLY UNTIL PROD WEBHOOK CONFIGURATION IS AUTHORIZED.
-- Separate store for Asaas production. No sandbox/legacy event is modified.
-- This inbox does not update payments, sales, CRM entitlements or users.
create table if not exists public.nexus_crm_asaas_production_events (
 provider_event_id text primary key
   check (provider_event_id ~ '^asaas:evt_[A-Za-z0-9_&.-]{6,150}$'),
 environment text not null default 'production' check (environment = 'production'),
 event_type text not null check (event_type ~ '^(PAYMENT|SUBSCRIPTION)_[A-Z0-9_]{2,90}$'),
 resource_id text not null check (resource_id ~ '^(pay|sub)_[A-Za-z0-9_-]{5,120}$'),
 payload jsonb not null,
 received_at timestamptz not null default now()
);
create index if not exists nexus_crm_asaas_production_events_received_idx
 on public.nexus_crm_asaas_production_events (received_at desc);
alter table public.nexus_crm_asaas_production_events enable row level security;
revoke all on public.nexus_crm_asaas_production_events
 from public, anon, authenticated;
grant select, insert on public.nexus_crm_asaas_production_events to service_role;
-- No policies. The service-only inbox uses server-validated webhook tokens.
-- Future worker requires explicit production settlement/claim authorization.
