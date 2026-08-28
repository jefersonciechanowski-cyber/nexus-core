drop policy if exists "nexus admin read ai entitlements" on public.nexus_ai_entitlements;
drop policy if exists "nexus admin read ai controls" on public.nexus_ai_controls;
drop policy if exists "nexus admin manage ai entitlements" on public.nexus_ai_entitlements;
drop policy if exists "nexus admin manage ai controls" on public.nexus_ai_controls;
drop policy if exists "nexus admin manage ai user access" on public.nexus_ai_user_access;
drop policy if exists "nexus admin manage ai usage" on public.nexus_ai_usage_events;
drop policy if exists "nexus ai user access self or admin read" on public.nexus_ai_user_access;
drop policy if exists "nexus ai usage self or admin read" on public.nexus_ai_usage_events;

create policy "nexus admin manage ai entitlements"
on public.nexus_ai_entitlements
for all
to authenticated
using (public.is_nexus_admin())
with check (public.is_nexus_admin());

create policy "nexus admin manage ai controls"
on public.nexus_ai_controls
for all
to authenticated
using (public.is_nexus_admin())
with check (public.is_nexus_admin());

create policy "nexus ai user access read"
on public.nexus_ai_user_access
for select
to authenticated
using (
  public.is_nexus_admin()
  or user_id = (select auth.uid())
);

create policy "nexus admin insert ai user access"
on public.nexus_ai_user_access
for insert
to authenticated
with check (public.is_nexus_admin());

create policy "nexus admin update ai user access"
on public.nexus_ai_user_access
for update
to authenticated
using (public.is_nexus_admin())
with check (public.is_nexus_admin());

create policy "nexus admin delete ai user access"
on public.nexus_ai_user_access
for delete
to authenticated
using (public.is_nexus_admin());

create policy "nexus ai usage read"
on public.nexus_ai_usage_events
for select
to authenticated
using (
  public.is_nexus_admin()
  or user_id = (select auth.uid())
);

create policy "nexus admin insert ai usage"
on public.nexus_ai_usage_events
for insert
to authenticated
with check (public.is_nexus_admin());

create policy "nexus admin update ai usage"
on public.nexus_ai_usage_events
for update
to authenticated
using (public.is_nexus_admin())
with check (public.is_nexus_admin());

create policy "nexus admin delete ai usage"
on public.nexus_ai_usage_events
for delete
to authenticated
using (public.is_nexus_admin());
