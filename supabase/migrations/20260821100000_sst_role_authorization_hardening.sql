begin;

-- Role-aware authorization for SST tenant writes.
-- Read access remains tenant-scoped; write access now also requires an allowed app role.

-- Organizational structure: admins and SST managers only.
drop policy if exists "tenant insert" on public.units;
drop policy if exists "tenant update" on public.units;
drop policy if exists "tenant delete" on public.units;
create policy "tenant insert" on public.units for insert to authenticated
with check (((organization_id = public.current_org_id()) or public.is_nexus_admin()) and exists (select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));
create policy "tenant update" on public.units for update to authenticated
using (((organization_id = public.current_org_id()) or public.is_nexus_admin()) and exists (select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')))
with check (((organization_id = public.current_org_id()) or public.is_nexus_admin()) and exists (select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));
create policy "tenant delete" on public.units for delete to authenticated
using (((organization_id = public.current_org_id()) or public.is_nexus_admin()) and exists (select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));

drop policy if exists "tenant insert" on public.sectors;
drop policy if exists "tenant update" on public.sectors;
drop policy if exists "tenant delete" on public.sectors;
create policy "tenant insert" on public.sectors for insert to authenticated with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));
create policy "tenant update" on public.sectors for update to authenticated using (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager'))) with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));
create policy "tenant delete" on public.sectors for delete to authenticated using (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));

drop policy if exists "tenant insert" on public.job_roles;
drop policy if exists "tenant update" on public.job_roles;
drop policy if exists "tenant delete" on public.job_roles;
create policy "tenant insert" on public.job_roles for insert to authenticated with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));
create policy "tenant update" on public.job_roles for update to authenticated using (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager'))) with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));
create policy "tenant delete" on public.job_roles for delete to authenticated using (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));

-- Employees: admins/SST manager/HR can maintain records; technicians/director/viewer are read-only.
drop policy if exists "tenant insert" on public.employees;
drop policy if exists "tenant update" on public.employees;
drop policy if exists "tenant delete" on public.employees;
create policy "tenant insert" on public.employees for insert to authenticated with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager','hr')));
create policy "tenant update" on public.employees for update to authenticated using (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager','hr'))) with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager','hr')));
create policy "tenant delete" on public.employees for delete to authenticated using (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));

-- Catalog/configuration tables: admins and SST manager only.
drop policy if exists "exam catalog tenant insert" on public.exam_catalog;
drop policy if exists "exam catalog tenant update" on public.exam_catalog;
drop policy if exists "exam catalog tenant delete" on public.exam_catalog;
create policy "exam catalog tenant insert" on public.exam_catalog for insert to authenticated with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));
create policy "exam catalog tenant update" on public.exam_catalog for update to authenticated using (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager'))) with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));
create policy "exam catalog tenant delete" on public.exam_catalog for delete to authenticated using (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));

drop policy if exists "sector exam requirements tenant insert" on public.sector_exam_requirements;
drop policy if exists "sector exam requirements tenant update" on public.sector_exam_requirements;
drop policy if exists "sector exam requirements tenant delete" on public.sector_exam_requirements;
create policy "sector exam requirements tenant insert" on public.sector_exam_requirements for insert to authenticated with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));
create policy "sector exam requirements tenant update" on public.sector_exam_requirements for update to authenticated using (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager'))) with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));
create policy "sector exam requirements tenant delete" on public.sector_exam_requirements for delete to authenticated using (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));

drop policy if exists "training catalog tenant insert" on public.training_catalog;
drop policy if exists "training catalog tenant update" on public.training_catalog;
drop policy if exists "training catalog tenant delete" on public.training_catalog;
create policy "training catalog tenant insert" on public.training_catalog for insert to authenticated with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));
create policy "training catalog tenant update" on public.training_catalog for update to authenticated using (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager'))) with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));
create policy "training catalog tenant delete" on public.training_catalog for delete to authenticated using (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));

drop policy if exists "tenant insert" on public.control_matrix_rules;
drop policy if exists "tenant update" on public.control_matrix_rules;
drop policy if exists "tenant delete" on public.control_matrix_rules;
create policy "tenant insert" on public.control_matrix_rules for insert to authenticated with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));
create policy "tenant update" on public.control_matrix_rules for update to authenticated using (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager'))) with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));
create policy "tenant delete" on public.control_matrix_rules for delete to authenticated using (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));

-- Exam evaluation rules inherit organization through exam_catalog and are config-only.
drop policy if exists "exam evaluation rules insert" on public.exam_evaluation_rules;
drop policy if exists "exam evaluation rules update" on public.exam_evaluation_rules;
drop policy if exists "exam evaluation rules delete" on public.exam_evaluation_rules;
create policy "exam evaluation rules insert" on public.exam_evaluation_rules for insert to authenticated with check (exists(select 1 from public.exam_catalog e where e.id=exam_evaluation_rules.exam_id and ((e.organization_id=public.current_org_id()) or public.is_nexus_admin())) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));
create policy "exam evaluation rules update" on public.exam_evaluation_rules for update to authenticated using (exists(select 1 from public.exam_catalog e where e.id=exam_evaluation_rules.exam_id and ((e.organization_id=public.current_org_id()) or public.is_nexus_admin())) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager'))) with check (exists(select 1 from public.exam_catalog e where e.id=exam_evaluation_rules.exam_id and ((e.organization_id=public.current_org_id()) or public.is_nexus_admin())) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));
create policy "exam evaluation rules delete" on public.exam_evaluation_rules for delete to authenticated using (exists(select 1 from public.exam_catalog e where e.id=exam_evaluation_rules.exam_id and ((e.organization_id=public.current_org_id()) or public.is_nexus_admin())) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));

-- Operational SST records: technician can write; director/viewer/HR cannot.
drop policy if exists "tenant insert" on public.exam_records;
drop policy if exists "tenant update" on public.exam_records;
create policy "tenant insert" on public.exam_records for insert to authenticated with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager','sst_technician')));
create policy "tenant update" on public.exam_records for update to authenticated using (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager','sst_technician'))) with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager','sst_technician')));

drop policy if exists "tenant insert" on public.training_records;
drop policy if exists "tenant update" on public.training_records;
create policy "tenant insert" on public.training_records for insert to authenticated with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager','sst_technician')));
create policy "tenant update" on public.training_records for update to authenticated using (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager','sst_technician'))) with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager','sst_technician')));

drop policy if exists "occurrence types tenant insert" on public.occurrence_types;
drop policy if exists "occurrence types tenant update" on public.occurrence_types;
create policy "occurrence types tenant insert" on public.occurrence_types for insert to authenticated with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));
create policy "occurrence types tenant update" on public.occurrence_types for update to authenticated using (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager'))) with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));

drop policy if exists "tenant insert" on public.occurrences;
drop policy if exists "tenant update" on public.occurrences;
create policy "tenant insert" on public.occurrences for insert to authenticated with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager','sst_technician')));
create policy "tenant update" on public.occurrences for update to authenticated using (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager','sst_technician'))) with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager','sst_technician')));

-- EPI operations: technician allowed for movement; catalog maintenance is manager/admin only.
drop policy if exists "epi catalog tenant insert" on public.epi_catalog;
drop policy if exists "epi catalog tenant update" on public.epi_catalog;
create policy "epi catalog tenant insert" on public.epi_catalog for insert to authenticated with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));
create policy "epi catalog tenant update" on public.epi_catalog for update to authenticated using (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager'))) with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager')));

drop policy if exists "epi purchases tenant insert" on public.epi_purchases;
drop policy if exists "epi purchases tenant update" on public.epi_purchases;
create policy "epi purchases tenant insert" on public.epi_purchases for insert to authenticated with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager','sst_technician')));
create policy "epi purchases tenant update" on public.epi_purchases for update to authenticated using (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager','sst_technician'))) with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager','sst_technician')));

drop policy if exists "epi deliveries tenant insert" on public.epi_deliveries;
drop policy if exists "epi deliveries tenant update" on public.epi_deliveries;
create policy "epi deliveries tenant insert" on public.epi_deliveries for insert to authenticated with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager','sst_technician')));
create policy "epi deliveries tenant update" on public.epi_deliveries for update to authenticated using (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager','sst_technician'))) with check (((organization_id=public.current_org_id()) or public.is_nexus_admin()) and exists(select 1 from public.profiles p where p.id=auth.uid() and p.active and p.role in ('nexus_admin','org_admin','sst_manager','sst_technician')));

revoke insert, update, delete on public.units, public.sectors, public.job_roles, public.employees, public.exam_catalog, public.exam_evaluation_rules, public.sector_exam_requirements, public.exam_records, public.training_catalog, public.training_records, public.control_matrix_rules, public.epi_catalog, public.epi_purchases, public.epi_deliveries, public.occurrence_types, public.occurrences from anon;

commit;
