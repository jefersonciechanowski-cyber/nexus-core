begin;

-- Remove client privileges that bypass or exceed the row-level access model.
revoke all privileges on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

alter default privileges in schema public
  revoke all privileges on tables from anon;
alter default privileges in schema public
  revoke truncate, references, trigger on tables from authenticated;

-- Keep tenant helper RPCs available only to signed-in users because RLS policies depend on them.
revoke execute on function public.current_org_id() from public, anon;
grant execute on function public.current_org_id() to authenticated;

revoke execute on function public.is_nexus_admin() from public, anon;
grant execute on function public.is_nexus_admin() to authenticated;

-- Document generation is the only SECURITY DEFINER RPC intentionally exposed to signed-in users.
revoke execute on function public.log_sst_document_generation(text, text, uuid, jsonb)
  from public, anon;
grant execute on function public.log_sst_document_generation(text, text, uuid, jsonb)
  to authenticated;

-- Trigger/event-trigger helpers must never be callable through PostgREST RPC.
revoke execute on function public.audit_company_logo_change()
  from public, anon, authenticated;
revoke execute on function public.audit_occurrence_change()
  from public, anon, authenticated;
revoke execute on function public.audit_occurrence_type_change()
  from public, anon, authenticated;
revoke execute on function public.audit_training_record_change()
  from public, anon, authenticated;
revoke execute on function public.enforce_occurrence_integrity()
  from public, anon, authenticated;
revoke execute on function public.enforce_sst_employee_plan_limit()
  from public, anon, authenticated;
revoke execute on function public.enforce_training_certificate_context()
  from public, anon, authenticated;
revoke execute on function public.enforce_training_record_integrity()
  from public, anon, authenticated;

-- These helpers were created only in some repair environments; guard them so a clean install remains reproducible.
do $$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;

  if to_regprocedure('public.wait_onboarding_email_dedup()') is not null then
    execute 'alter function public.wait_onboarding_email_dedup() set search_path = public, pg_temp';
    execute 'revoke execute on function public.wait_onboarding_email_dedup() from public, anon, authenticated';
  end if;
end;
$$;

-- Internal counters are intentionally inaccessible to clients; policies document that intent.
alter table public.occurrence_code_counters enable row level security;
alter table public.training_record_code_counters enable row level security;
revoke all privileges on table public.occurrence_code_counters,
  public.training_record_code_counters from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'occurrence_code_counters'
      and policyname = 'internal occurrence counters deny client access'
  ) then
    create policy "internal occurrence counters deny client access"
      on public.occurrence_code_counters
      for all to authenticated
      using (false)
      with check (false);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'training_record_code_counters'
      and policyname = 'internal training counters deny client access'
  ) then
    create policy "internal training counters deny client access"
      on public.training_record_code_counters
      for all to authenticated
      using (false)
      with check (false);
  end if;
end;
$$;

-- Restore only the tenant writes required by the current SST frontend.
grant select on table public.organizations to authenticated;
grant update (
  legal_name,
  trade_name,
  registration_type,
  registration_number,
  state_registration,
  cnae_code,
  email,
  phone,
  postal_code,
  street,
  street_number,
  address_complement,
  district,
  city,
  state,
  legal_responsible_name,
  legal_responsible_cpf,
  legal_responsible_role,
  logo_path
) on public.organizations to authenticated;

grant select on table public.control_matrix_rules to authenticated;
grant insert (
  organization_id,
  unit_id,
  sector_id,
  job_role_id,
  requirement_type,
  exam_id,
  training_id,
  epi_id,
  requirement_name,
  validity_days,
  effective_from,
  active
) on public.control_matrix_rules to authenticated;
grant update (active)
  on public.control_matrix_rules to authenticated;

grant select on table public.epi_catalog, public.epi_purchases, public.epi_deliveries
  to authenticated;
grant insert (organization_id, name, code, active)
  on public.epi_catalog to authenticated;
grant update (name, code, active)
  on public.epi_catalog to authenticated;
grant insert (
  organization_id,
  epi_id,
  purchased_at,
  quantity,
  supplier,
  invoice_number,
  technical_responsible
) on public.epi_purchases to authenticated;
grant update (
  epi_id,
  purchased_at,
  quantity,
  supplier,
  invoice_number,
  technical_responsible
) on public.epi_purchases to authenticated;
grant insert (
  organization_id,
  employee_id,
  epi_id,
  delivered_at
) on public.epi_deliveries to authenticated;
grant update (
  returned_at,
  return_reason,
  final_disposition
) on public.epi_deliveries to authenticated;

grant select on table public.occurrence_types, public.occurrences to authenticated;
grant insert (organization_id, name)
  on public.occurrence_types to authenticated;
grant update (active)
  on public.occurrence_types to authenticated;
grant insert (
  organization_id,
  employee_id,
  occurrence_type_id,
  severity,
  description,
  occurred_at
) on public.occurrences to authenticated;
grant update (status, cancel_reason)
  on public.occurrences to authenticated;

grant select on table public.training_records to authenticated;
grant insert (
  organization_id,
  employee_id,
  training_type_id,
  completed_at,
  certificate_number,
  instructor_name,
  instructor_entity,
  instructor_document,
  workload_hours,
  modality,
  training_location,
  program_content,
  notes,
  training_kind,
  technical_responsible_name,
  technical_responsible_qualification
) on public.training_records to authenticated;
grant update (status, cancel_reason)
  on public.training_records to authenticated;

grant select on public.notification_alert_states to authenticated;
grant insert (
  organization_id,
  alert_key,
  category,
  due_date,
  first_seen_at,
  last_seen_at,
  read_at
) on public.notification_alert_states to authenticated;
grant update (
  category,
  due_date,
  last_seen_at,
  read_at,
  updated_at
) on public.notification_alert_states to authenticated;

grant select on public.notification_email_preferences to authenticated;
grant insert (organization_id, enabled, recipients, deadline_statuses)
  on public.notification_email_preferences to authenticated;
grant update (enabled, recipients, deadline_statuses, updated_at)
  on public.notification_email_preferences to authenticated;
grant select on public.notification_delivery_logs to authenticated;

-- Defense in depth: prevent cross-organization unit/sector/job-role links even with crafted requests.
create or replace function public.enforce_core_organization_links()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'sectors' then
    if new.unit_id is not null and not exists (
      select 1
      from public.units unit_row
      where unit_row.id = new.unit_id
        and unit_row.organization_id = new.organization_id
    ) then
      raise exception 'O setor deve utilizar uma unidade da mesma organização.';
    end if;
    return new;
  end if;

  if tg_table_name = 'employees' then
    if new.unit_id is not null and not exists (
      select 1
      from public.units unit_row
      where unit_row.id = new.unit_id
        and unit_row.organization_id = new.organization_id
    ) then
      raise exception 'O colaborador deve utilizar uma unidade da mesma organização.';
    end if;

    if new.sector_id is not null and not exists (
      select 1
      from public.sectors sector_row
      where sector_row.id = new.sector_id
        and sector_row.organization_id = new.organization_id
        and (new.unit_id is null or sector_row.unit_id = new.unit_id)
    ) then
      raise exception 'O colaborador deve utilizar um setor da mesma organização e unidade.';
    end if;

    if new.job_role_id is not null and not exists (
      select 1
      from public.job_roles role_row
      where role_row.id = new.job_role_id
        and role_row.organization_id = new.organization_id
    ) then
      raise exception 'O colaborador deve utilizar um cargo da mesma organização.';
    end if;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_core_organization_links()
  from public, anon, authenticated;

drop trigger if exists sectors_organization_link_guard on public.sectors;
create trigger sectors_organization_link_guard
before insert or update of organization_id, unit_id on public.sectors
for each row execute function public.enforce_core_organization_links();

drop trigger if exists employees_organization_link_guard on public.employees;
create trigger employees_organization_link_guard
before insert or update of organization_id, unit_id, sector_id, job_role_id on public.employees
for each row execute function public.enforce_core_organization_links();

commit;
