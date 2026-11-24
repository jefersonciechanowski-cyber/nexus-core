-- Nexus Central: Web Push subscriptions stored only for the backend.
-- VAPID private key is inserted separately into Supabase Vault, NEVER in Git.
create table if not exists public.nexus_support_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth_secret text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  last_test_at timestamptz,
  constraint nexus_support_push_endpoint_length check (char_length(endpoint) between 25 and 2048 and endpoint like 'https://%'),
  constraint nexus_support_push_p256dh_length check (char_length(p256dh) between 65 and 150),
  constraint nexus_support_push_auth_length check (char_length(auth_secret) between 15 and 60)
);

create index if not exists nexus_support_push_user_idx
  on public.nexus_support_push_subscriptions (user_id,created_at desc);

alter table public.nexus_support_push_subscriptions enable row level security;
revoke all on public.nexus_support_push_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on public.nexus_support_push_subscriptions to service_role;

alter table public.support_requests
  add column if not exists push_dispatched_at timestamptz;

-- Service-role-only RPC; executes as migration owner to read the encrypted Vault secret.
-- This SQL function MUST NEVER be exposed to anon or authenticated roles.
create or replace function public.nexus_support_push_vapid()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select v.decrypted_secret
  from vault.decrypted_secrets as v
  where v.name = 'nexus_support_webpush_vapid_v1'
  limit 1;
$$;

revoke all on function public.nexus_support_push_vapid() from public, anon, authenticated;
grant execute on function public.nexus_support_push_vapid() to service_role;

comment on table public.nexus_support_push_subscriptions is
  'Private web push subscriptions for Nexus Central administrators, accessible only through the support push Edge Function.';
comment on column public.support_requests.push_dispatched_at is
  'Atomic claim for at-most-once Web Push dispatch by the support push backend.';
