-- Restrict document mutations by both tenant and application role.
-- Read access remains tenant-scoped so viewer/director roles can consult evidence,
-- while only operational roles can upload or replace files and only managers can delete.

drop policy if exists "sst documents tenant insert" on storage.objects;
drop policy if exists "sst documents tenant update" on storage.objects;
drop policy if exists "sst documents tenant delete" on storage.objects;

create policy "sst documents tenant insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'sst-documents'
  and (
    (storage.foldername(name))[1] = (select public.current_org_id())::text
    or (select public.is_nexus_admin())
  )
  and (
    (select public.is_nexus_admin())
    or exists (
      select 1
      from public.profiles profile
      where profile.id = (select auth.uid())
        and profile.active
        and profile.role = any (array[
          'org_admin'::public.app_role,
          'sst_manager'::public.app_role,
          'sst_technician'::public.app_role
        ])
    )
  )
);

create policy "sst documents tenant update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'sst-documents'
  and (
    (storage.foldername(name))[1] = (select public.current_org_id())::text
    or (select public.is_nexus_admin())
  )
  and (
    (select public.is_nexus_admin())
    or exists (
      select 1
      from public.profiles profile
      where profile.id = (select auth.uid())
        and profile.active
        and profile.role = any (array[
          'org_admin'::public.app_role,
          'sst_manager'::public.app_role,
          'sst_technician'::public.app_role
        ])
    )
  )
)
with check (
  bucket_id = 'sst-documents'
  and (
    (storage.foldername(name))[1] = (select public.current_org_id())::text
    or (select public.is_nexus_admin())
  )
  and (
    (select public.is_nexus_admin())
    or exists (
      select 1
      from public.profiles profile
      where profile.id = (select auth.uid())
        and profile.active
        and profile.role = any (array[
          'org_admin'::public.app_role,
          'sst_manager'::public.app_role,
          'sst_technician'::public.app_role
        ])
    )
  )
);

create policy "sst documents tenant delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'sst-documents'
  and (
    (storage.foldername(name))[1] = (select public.current_org_id())::text
    or (select public.is_nexus_admin())
  )
  and (
    (select public.is_nexus_admin())
    or exists (
      select 1
      from public.profiles profile
      where profile.id = (select auth.uid())
        and profile.active
        and profile.role = any (array[
          'org_admin'::public.app_role,
          'sst_manager'::public.app_role
        ])
    )
  )
);
