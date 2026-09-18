begin;

-- Central Nexus security hardening v2
-- Admin status now requires an active profile and audit history becomes immutable
-- to browser/API clients.

create or replace function public.is_nexus_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
     and exists (
       select 1
       from public.profiles
       where id = auth.uid()
         and role = 'nexus_admin'
         and active = true
     );
$$;

create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.profiles
  where id = auth.uid()
    and active = true
$$;

revoke all on function public.is_nexus_admin() from public, anon;
grant execute on function public.is_nexus_admin() to authenticated;
revoke all on function public.current_org_id() from public, anon;
grant execute on function public.current_org_id() to authenticated;

drop policy if exists "tenant delete" on public.audit_logs;
drop policy if exists "tenant update" on public.audit_logs;
drop policy if exists "tenant insert" on public.audit_logs;
drop policy if exists "tenant select" on public.audit_logs;

revoke all on table public.audit_logs from public, anon, authenticated;
grant select on table public.audit_logs to authenticated;

create policy "nexus admin read audit logs"
  on public.audit_logs
  for select
  to authenticated
  using ((select public.is_nexus_admin()));

comment on table public.audit_logs is
  'Append-only audit trail. Direct browser/API writes are denied; trusted SECURITY DEFINER/server code may append records.';

commit;
