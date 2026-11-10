-- Production-controlled, fail-closed SST Asaas release gates. Finance code cannot
-- charge or activate any customer until the backend verifies the provider connection.
begin;

create table if not exists public.nexus_sst_asaas_release_controls (
  id text primary key check (id='production'),
  checkout_enabled boolean not null default false,
  reconciliation_enabled boolean not null default false,
  asaas_connection_verified_at timestamptz,
  webhook_secret_present_at timestamptz,
  worker_heartbeat_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.nexus_sst_asaas_release_controls(id)
values ('production')
on conflict (id) do nothing;

alter table public.nexus_sst_asaas_release_controls enable row level security;
revoke all on public.nexus_sst_asaas_release_controls from public, anon, authenticated;
grant select,update on public.nexus_sst_asaas_release_controls to service_role;

commit;
