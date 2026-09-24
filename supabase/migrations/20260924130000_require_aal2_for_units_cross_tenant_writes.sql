begin;

-- Finalize AAL2 hardening for cross-tenant writes on establishment units.
-- Normal tenant-scoped access and roles remain governed by the existing policies.

drop policy if exists "units cross tenant nexus admin writes require aal2" on public.units;
create policy "units cross tenant nexus admin writes require aal2"
on public.units
as restrictive
for all
to authenticated
using (
  not public.is_nexus_admin()
  or organization_id = public.current_org_id()
  or public.is_nexus_admin_aal2()
)
with check (
  not public.is_nexus_admin()
  or organization_id = public.current_org_id()
  or public.is_nexus_admin_aal2()
);

commit;
