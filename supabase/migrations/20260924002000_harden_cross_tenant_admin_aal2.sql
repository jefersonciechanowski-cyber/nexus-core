begin;

-- Require an AAL2 Nexus admin session only for global/cross-tenant administrative
-- bypasses. Tenant-scoped access for normal users remains unchanged.

-- Audit logs: global Nexus admin read requires AAL2.
drop policy if exists "nexus admin read audit logs" on public.audit_logs;
create policy "nexus admin read audit logs"
on public.audit_logs
for select
to authenticated
using (public.is_nexus_admin_aal2());

-- Profiles: users still read their own profile via the existing policy.
-- Reading all profiles as Nexus admin requires AAL2.
drop policy if exists "nexus admin read all profiles" on public.profiles;
create policy "nexus admin read all profiles"
on public.profiles
for select
to authenticated
using (public.is_nexus_admin_aal2());

-- Support queue: global read/update requires AAL2.
drop policy if exists "nexus admins read support requests" on public.support_requests;
create policy "nexus admins read support requests"
on public.support_requests
for select
to authenticated
using (public.is_nexus_admin_aal2());

drop policy if exists "nexus admins update support requests" on public.support_requests;
create policy "nexus admins update support requests"
on public.support_requests
for update
to authenticated
using (public.is_nexus_admin_aal2())
with check (public.is_nexus_admin_aal2());

-- Private SST documents: normal users keep tenant-folder access.
-- The Nexus admin global override now requires AAL2.
drop policy if exists "sst documents tenant select" on storage.objects;
create policy "sst documents tenant select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'sst-documents'
  and (
    (storage.foldername(name))[1] = public.current_org_id()::text
    or public.is_nexus_admin_aal2()
  )
);

drop policy if exists "sst documents tenant insert" on storage.objects;
create policy "sst documents tenant insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'sst-documents'
  and (
    (storage.foldername(name))[1] = public.current_org_id()::text
    or public.is_nexus_admin_aal2()
  )
  and (
    public.is_nexus_admin_aal2()
    or exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.active
        and profile.role = any (
          array[
            'org_admin'::public.app_role,
            'sst_manager'::public.app_role,
            'sst_technician'::public.app_role
          ]
        )
    )
  )
);

drop policy if exists "sst documents tenant update" on storage.objects;
create policy "sst documents tenant update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'sst-documents'
  and (
    (storage.foldername(name))[1] = public.current_org_id()::text
    or public.is_nexus_admin_aal2()
  )
  and (
    public.is_nexus_admin_aal2()
    or exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.active
        and profile.role = any (
          array[
            'org_admin'::public.app_role,
            'sst_manager'::public.app_role,
            'sst_technician'::public.app_role
          ]
        )
    )
  )
)
with check (
  bucket_id = 'sst-documents'
  and (
    (storage.foldername(name))[1] = public.current_org_id()::text
    or public.is_nexus_admin_aal2()
  )
  and (
    public.is_nexus_admin_aal2()
    or exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.active
        and profile.role = any (
          array[
            'org_admin'::public.app_role,
            'sst_manager'::public.app_role,
            'sst_technician'::public.app_role
          ]
        )
    )
  )
);

drop policy if exists "sst documents tenant delete" on storage.objects;
create policy "sst documents tenant delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'sst-documents'
  and (
    (storage.foldername(name))[1] = public.current_org_id()::text
    or public.is_nexus_admin_aal2()
  )
  and (
    public.is_nexus_admin_aal2()
    or exists (
      select 1
      from public.profiles profile
      where profile.id = auth.uid()
        and profile.active
        and profile.role = any (
          array[
            'org_admin'::public.app_role,
            'sst_manager'::public.app_role
          ]
        )
    )
  )
);

commit;
