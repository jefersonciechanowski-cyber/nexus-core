begin;

create table if not exists public.notification_email_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  enabled boolean not null default false,
  recipients text[] not null default '{}'::text[],
  deadline_statuses text[] not null default array['OVERDUE','DUE_7','DUE_15','DUE_30']::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_email_preferences_org_unique unique (organization_id),
  constraint notification_email_preferences_recipients_limit check (cardinality(recipients) <= 10),
  constraint notification_email_preferences_deadlines_valid check (
    deadline_statuses <@ array['OVERDUE','DUE_7','DUE_15','DUE_30']::text[]
  )
);

create table if not exists public.notification_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  alert_key text not null,
  due_date date not null,
  channel text not null check (channel in ('email','whatsapp')),
  recipient text not null,
  status text not null check (status in ('sent','failed','skipped')),
  provider_message_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_delivery_logs_attempt_unique
    unique (organization_id, alert_key, due_date, channel, recipient)
);

create index if not exists notification_delivery_logs_history_idx
  on public.notification_delivery_logs (organization_id, channel, created_at desc);

alter table public.notification_email_preferences enable row level security;
alter table public.notification_delivery_logs enable row level security;

create policy "email preferences tenant select"
  on public.notification_email_preferences for select to authenticated
  using (organization_id = public.current_org_id() or public.is_nexus_admin());
create policy "email preferences tenant insert"
  on public.notification_email_preferences for insert to authenticated
  with check (organization_id = public.current_org_id() or public.is_nexus_admin());
create policy "email preferences tenant update"
  on public.notification_email_preferences for update to authenticated
  using (organization_id = public.current_org_id() or public.is_nexus_admin())
  with check (organization_id = public.current_org_id() or public.is_nexus_admin());
create policy "delivery logs tenant select"
  on public.notification_delivery_logs for select to authenticated
  using (organization_id = public.current_org_id() or public.is_nexus_admin());

grant select on public.notification_email_preferences to authenticated;
grant insert (organization_id, enabled, recipients, deadline_statuses)
  on public.notification_email_preferences to authenticated;
grant update (enabled, recipients, deadline_statuses, updated_at)
  on public.notification_email_preferences to authenticated;
grant select on public.notification_delivery_logs to authenticated;

commit;
