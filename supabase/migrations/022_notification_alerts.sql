begin;

create table if not exists public.notification_alert_states (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  alert_key text not null,
  category text not null check (category in ('Exame', 'Treinamento', 'EPI')),
  due_date date not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  read_at timestamptz,
  email_sent_at timestamptz,
  whatsapp_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_alert_states_org_key_unique unique (organization_id, alert_key)
);

create index if not exists notification_alert_states_pending_idx
  on public.notification_alert_states (organization_id, read_at, due_date);

alter table public.notification_alert_states enable row level security;

create policy "notification alerts tenant select"
  on public.notification_alert_states for select to authenticated
  using (organization_id = public.current_org_id() or public.is_nexus_admin());
create policy "notification alerts tenant insert"
  on public.notification_alert_states for insert to authenticated
  with check (organization_id = public.current_org_id() or public.is_nexus_admin());
create policy "notification alerts tenant update"
  on public.notification_alert_states for update to authenticated
  using (organization_id = public.current_org_id() or public.is_nexus_admin())
  with check (organization_id = public.current_org_id() or public.is_nexus_admin());

grant select on public.notification_alert_states to authenticated;
grant insert (organization_id, alert_key, category, due_date, first_seen_at, last_seen_at, read_at)
  on public.notification_alert_states to authenticated;
grant update (category, due_date, last_seen_at, read_at, updated_at)
  on public.notification_alert_states to authenticated;

commit;
