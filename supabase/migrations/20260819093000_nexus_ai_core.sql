create table if not exists public.nexus_ai_entitlements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_code text not null,
  package_code text not null check (package_code in ('assist','intelligence','automation','custom')),
  provider_mode text not null default 'nexus_managed' check (provider_mode in ('nexus_managed','customer_openai')),
  capabilities jsonb not null default '[]'::jsonb check (jsonb_typeof(capabilities) = 'array'),
  monthly_request_limit integer not null check (monthly_request_limit >= 0),
  monthly_token_limit bigint not null check (monthly_token_limit >= 0),
  monthly_cost_limit_microusd bigint check (monthly_cost_limit_microusd is null or monthly_cost_limit_microusd >= 0),
  enabled boolean not null default false,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, product_code),
  check (ends_at is null or ends_at > starts_at)
);

create table if not exists public.nexus_ai_controls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_code text not null,
  customer_enabled boolean not null default false,
  paused_until timestamptz,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, product_code)
);

create table if not exists public.nexus_ai_user_access (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_code text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_mode text not null default 'inherit' check (access_mode in ('inherit','allow','block','pause')),
  paused_until timestamptz,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, product_code, user_id),
  check (
    (access_mode = 'pause' and paused_until is not null)
    or (access_mode <> 'pause' and paused_until is null)
  )
);

create table if not exists public.nexus_ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_code text not null,
  user_id uuid references auth.users(id) on delete set null,
  capability text not null,
  package_code text not null check (package_code in ('assist','intelligence','automation','custom')),
  provider text,
  model text,
  status text not null default 'reserved' check (status in ('reserved','success','error','cancelled')),
  reserved_tokens integer not null default 0 check (reserved_tokens >= 0),
  input_tokens integer not null default 0 check (input_tokens >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  total_tokens integer not null default 0 check (total_tokens >= 0),
  estimated_cost_microusd bigint check (estimated_cost_microusd is null or estimated_cost_microusd >= 0),
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  check (total_tokens >= input_tokens and total_tokens >= output_tokens)
);

-- The UNIQUE constraints above already provide the lookup indexes for the
-- entitlement/control/user-access organization+product keys. The indexes below
-- cover history queries and foreign-key maintenance paths not covered by them.
create index if not exists idx_nexus_ai_usage_org_product_created
  on public.nexus_ai_usage_events (organization_id, product_code, created_at desc);
create index if not exists idx_nexus_ai_usage_status
  on public.nexus_ai_usage_events (status, created_at desc);
create index if not exists idx_nexus_ai_controls_updated_by
  on public.nexus_ai_controls (updated_by)
  where updated_by is not null;
create index if not exists idx_nexus_ai_user_access_user
  on public.nexus_ai_user_access (user_id);
create index if not exists idx_nexus_ai_user_access_updated_by
  on public.nexus_ai_user_access (updated_by)
  where updated_by is not null;
create index if not exists idx_nexus_ai_usage_user
  on public.nexus_ai_usage_events (user_id)
  where user_id is not null;

alter table public.nexus_ai_entitlements enable row level security;
alter table public.nexus_ai_controls enable row level security;
alter table public.nexus_ai_user_access enable row level security;
alter table public.nexus_ai_usage_events enable row level security;

-- Entitlements contain commercial limits/cost ceilings and controls contain
-- central governance state. Keep those direct tables Nexus-admin only. Product
-- UIs should receive sanitized capability/status data through explicit server
-- functions in a later migration rather than reading central commercial data.
create policy "nexus admin read ai entitlements"
on public.nexus_ai_entitlements for select
using (public.is_nexus_admin());

create policy "nexus admin read ai controls"
on public.nexus_ai_controls for select
using (public.is_nexus_admin());

create policy "nexus ai user access self or admin read"
on public.nexus_ai_user_access for select
using (
  public.is_nexus_admin()
  or user_id = auth.uid()
);

create policy "nexus ai usage self or admin read"
on public.nexus_ai_usage_events for select
using (
  public.is_nexus_admin()
  or user_id = auth.uid()
);

create policy "nexus admin manage ai entitlements"
on public.nexus_ai_entitlements for all
using (public.is_nexus_admin())
with check (public.is_nexus_admin());

create policy "nexus admin manage ai controls"
on public.nexus_ai_controls for all
using (public.is_nexus_admin())
with check (public.is_nexus_admin());

create policy "nexus admin manage ai user access"
on public.nexus_ai_user_access for all
using (public.is_nexus_admin())
with check (public.is_nexus_admin());

create policy "nexus admin manage ai usage"
on public.nexus_ai_usage_events for all
using (public.is_nexus_admin())
with check (public.is_nexus_admin());

revoke all on public.nexus_ai_entitlements from anon, authenticated;
revoke all on public.nexus_ai_controls from anon, authenticated;
revoke all on public.nexus_ai_user_access from anon, authenticated;
revoke all on public.nexus_ai_usage_events from anon, authenticated;

grant select on public.nexus_ai_entitlements to authenticated;
grant select on public.nexus_ai_controls to authenticated;
grant select on public.nexus_ai_user_access to authenticated;
grant select on public.nexus_ai_usage_events to authenticated;
