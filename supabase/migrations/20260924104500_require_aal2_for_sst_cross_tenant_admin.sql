begin;

-- Require AAL2 only when a Nexus admin crosses tenant boundaries in SST/HR.
-- Existing tenant-scoped permissions for normal users remain unchanged.

drop policy if exists "employees cross tenant nexus admin requires aal2" on public.employees;
create policy "employees cross tenant nexus admin requires aal2"
on public.employees
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

drop policy if exists "exam_catalog cross tenant nexus admin requires aal2" on public.exam_catalog;
create policy "exam_catalog cross tenant nexus admin requires aal2"
on public.exam_catalog
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

drop policy if exists "exam_records cross tenant nexus admin requires aal2" on public.exam_records;
create policy "exam_records cross tenant nexus admin requires aal2"
on public.exam_records
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

drop policy if exists "training_catalog cross tenant nexus admin requires aal2" on public.training_catalog;
create policy "training_catalog cross tenant nexus admin requires aal2"
on public.training_catalog
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

drop policy if exists "training_records cross tenant nexus admin requires aal2" on public.training_records;
create policy "training_records cross tenant nexus admin requires aal2"
on public.training_records
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

drop policy if exists "sectors cross tenant nexus admin requires aal2" on public.sectors;
create policy "sectors cross tenant nexus admin requires aal2"
on public.sectors
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

drop policy if exists "sector_exam_requirements cross tenant nexus admin requires aal2" on public.sector_exam_requirements;
create policy "sector_exam_requirements cross tenant nexus admin requires aal2"
on public.sector_exam_requirements
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

drop policy if exists "job_roles cross tenant nexus admin requires aal2" on public.job_roles;
create policy "job_roles cross tenant nexus admin requires aal2"
on public.job_roles
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

drop policy if exists "occurrences cross tenant nexus admin requires aal2" on public.occurrences;
create policy "occurrences cross tenant nexus admin requires aal2"
on public.occurrences
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

drop policy if exists "occurrence_types cross tenant nexus admin requires aal2" on public.occurrence_types;
create policy "occurrence_types cross tenant nexus admin requires aal2"
on public.occurrence_types
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

drop policy if exists "exam evaluation rules cross tenant nexus admin requires aal2"
on public.exam_evaluation_rules;
create policy "exam evaluation rules cross tenant nexus admin requires aal2"
on public.exam_evaluation_rules
as restrictive
for all
to authenticated
using (
  not public.is_nexus_admin()
  or exists (
    select 1
    from public.exam_catalog exam
    where exam.id = exam_evaluation_rules.exam_id
      and (
        exam.organization_id = public.current_org_id()
        or public.is_nexus_admin_aal2()
      )
  )
)
with check (
  not public.is_nexus_admin()
  or exists (
    select 1
    from public.exam_catalog exam
    where exam.id = exam_evaluation_rules.exam_id
      and (
        exam.organization_id = public.current_org_id()
        or public.is_nexus_admin_aal2()
      )
  )
);

commit;
