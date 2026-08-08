create or replace function public.has_valid_qualitative_options(options jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  option_item jsonb;
  option_label text;
  option_status text;
  normalized_labels text[] := array[]::text[];
begin
  if jsonb_typeof(options) <> 'array' then
    return false;
  end if;

  for option_item in select value from jsonb_array_elements(options)
  loop
    if jsonb_typeof(option_item) <> 'object' then
      return false;
    end if;

    option_label := nullif(btrim(option_item ->> 'label'), '');
    option_status := option_item ->> 'status';
    if option_label is null or option_status not in ('BOM', 'ATENÇÃO', 'CRÍTICO', 'SEM PARÂMETRO') then
      return false;
    end if;

    if lower(option_label) = any(normalized_labels) then
      return false;
    end if;
    normalized_labels := array_append(normalized_labels, lower(option_label));
  end loop;

  return true;
end;
$$;

alter table public.exam_catalog
  add column qualitative_options jsonb not null default '[]'::jsonb,
  add constraint exam_catalog_qualitative_options_check
    check (public.has_valid_qualitative_options(qualitative_options));

create table public.sector_exam_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sector_id uuid not null references public.sectors(id) on delete restrict,
  exam_id uuid not null references public.exam_catalog(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sector_exam_requirements_sector_exam_unique unique (sector_id, exam_id)
);

create index sector_exam_requirements_organization_sector_active_idx
  on public.sector_exam_requirements (organization_id, sector_id)
  where active = true;

alter table public.sector_exam_requirements enable row level security;

create policy "sector exam requirements tenant select"
  on public.sector_exam_requirements for select
  using (organization_id = public.current_org_id() or public.is_nexus_admin());

create policy "sector exam requirements tenant insert"
  on public.sector_exam_requirements for insert
  with check (organization_id = public.current_org_id() or public.is_nexus_admin());

create policy "sector exam requirements tenant update"
  on public.sector_exam_requirements for update
  using (organization_id = public.current_org_id() or public.is_nexus_admin())
  with check (organization_id = public.current_org_id() or public.is_nexus_admin());

create policy "sector exam requirements tenant delete"
  on public.sector_exam_requirements for delete
  using (organization_id = public.current_org_id() or public.is_nexus_admin());

create or replace function public.enforce_sector_exam_requirement_integrity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  sector_organization_id uuid;
  exam_organization_id uuid;
begin
  select organization_id into sector_organization_id
  from public.sectors
  where id = new.sector_id;

  select organization_id into exam_organization_id
  from public.exam_catalog
  where id = new.exam_id;

  if sector_organization_id is null or sector_organization_id <> new.organization_id then
    raise exception 'O setor deve pertencer à mesma organização do vínculo de exame.';
  end if;

  if exam_organization_id is null or exam_organization_id <> new.organization_id then
    raise exception 'O exame deve pertencer à mesma organização do vínculo de setor.';
  end if;

  return new;
end;
$$;

create trigger sector_exam_requirements_integrity
before insert or update on public.sector_exam_requirements
for each row
execute function public.enforce_sector_exam_requirement_integrity();

create or replace function public.set_sector_exam_requirements_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger sector_exam_requirements_set_updated_at
before update on public.sector_exam_requirements
for each row
execute function public.set_sector_exam_requirements_updated_at();

alter table public.exam_records
  add column qualitative_result text,
  add column result_type_snapshot text,
  add constraint exam_records_result_type_snapshot_check
    check (result_type_snapshot is null or result_type_snapshot in ('NUMERIC', 'QUALITATIVE')),
  add constraint exam_records_result_value_check
    check (
      result_type_snapshot is null
      or (result_type_snapshot = 'NUMERIC' and value is not null and qualitative_result is null)
      or (result_type_snapshot = 'QUALITATIVE' and value is null and nullif(btrim(qualitative_result), '') is not null)
    );

create or replace function public.enforce_exam_record_integrity_and_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  employee_record public.employees%rowtype;
  catalog_record public.exam_catalog%rowtype;
  requirement_exists boolean;
  should_validate_requirement boolean := false;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'O identificador da coleta não pode ser alterado.';
    end if;

    if new.organization_id is distinct from old.organization_id then
      raise exception 'A organização da coleta não pode ser alterada.';
    end if;

    if new.created_at is distinct from old.created_at then
      raise exception 'A data de criação da coleta não pode ser alterada.';
    end if;

    if new.exam_id is not distinct from old.exam_id then
      new.exam_name = old.exam_name;
      new.measurement_unit_snapshot = old.measurement_unit_snapshot;
      new.esocial_reportable_snapshot = old.esocial_reportable_snapshot;
      new.esocial_procedure_code_snapshot = old.esocial_procedure_code_snapshot;
      new.result_type_snapshot = old.result_type_snapshot;
    elsif new.exam_id is null then
      raise exception 'Uma coleta vinculada não pode ficar sem exame.';
    end if;

    should_validate_requirement := new.employee_id is distinct from old.employee_id
      or new.exam_id is distinct from old.exam_id;
  end if;

  select * into employee_record
  from public.employees
  where id = new.employee_id;

  if not found or employee_record.organization_id <> new.organization_id then
    raise exception 'O colaborador deve pertencer à mesma organização da coleta.';
  end if;

  if tg_op = 'INSERT' and new.exam_id is null then
    raise exception 'Novas coletas exigem exame.';
  end if;

  if new.exam_id is not null and new.collection_number is null then
    raise exception 'Coletas vinculadas a um exame exigem número da coleta.';
  end if;

  if tg_op = 'INSERT' or new.exam_id is distinct from old.exam_id then
    select * into catalog_record
    from public.exam_catalog
    where id = new.exam_id;

    if not found or catalog_record.organization_id <> new.organization_id then
      raise exception 'O exame deve pertencer à mesma organização da coleta.';
    end if;

    if not catalog_record.active then
      raise exception 'Somente exames ativos podem ser usados em coletas.';
    end if;

    new.exam_name = catalog_record.name;
    new.measurement_unit_snapshot = catalog_record.measurement_unit;
    new.esocial_reportable_snapshot = catalog_record.esocial_reportable;
    new.esocial_procedure_code_snapshot = catalog_record.esocial_procedure_code;
    new.result_type_snapshot = catalog_record.result_type;
    should_validate_requirement := true;

    if catalog_record.result_type = 'NUMERIC' then
      if new.value is null or new.qualitative_result is not null then
        raise exception 'Exames numéricos exigem valor numérico e não aceitam resultado qualitativo.';
      end if;
    elsif catalog_record.result_type = 'QUALITATIVE' then
      new.qualitative_result = nullif(btrim(new.qualitative_result), '');
      if new.value is not null or new.qualitative_result is null then
        raise exception 'Exames qualitativos exigem um resultado qualitativo e não aceitam valor numérico.';
      end if;
      select option_item ->> 'status' into new.status
      from jsonb_array_elements(catalog_record.qualitative_options) option_item
      where option_item ->> 'label' = new.qualitative_result;

      if not found or new.status not in ('BOM', 'ATENÇÃO', 'CRÍTICO', 'SEM PARÂMETRO') then
        raise exception 'O resultado qualitativo deve ser uma das opções configuradas para o exame.';
      end if;
    end if;
  elsif new.result_type_snapshot = 'NUMERIC' then
    if new.value is null or new.qualitative_result is not null then
      raise exception 'Exames numéricos exigem valor numérico e não aceitam resultado qualitativo.';
    end if;
  elsif new.result_type_snapshot = 'QUALITATIVE' then
    new.qualitative_result = nullif(btrim(new.qualitative_result), '');
    if new.value is not null or new.qualitative_result is null then
      raise exception 'Exames qualitativos exigem um resultado qualitativo e não aceitam valor numérico.';
    end if;
    if new.qualitative_result is not distinct from old.qualitative_result then
      new.status = old.status;
    else
      select * into catalog_record
      from public.exam_catalog
      where id = new.exam_id;

      select option_item ->> 'status' into new.status
      from jsonb_array_elements(catalog_record.qualitative_options) option_item
      where option_item ->> 'label' = new.qualitative_result;

      if not found or new.status not in ('BOM', 'ATENÇÃO', 'CRÍTICO', 'SEM PARÂMETRO') then
        raise exception 'O resultado qualitativo deve ser uma das opções configuradas para o exame.';
      end if;
    end if;
  end if;

  if should_validate_requirement then
    if not (tg_op = 'INSERT' or new.exam_id is distinct from old.exam_id) then
      select * into catalog_record
      from public.exam_catalog
      where id = new.exam_id;

      if not found or catalog_record.organization_id <> new.organization_id or not catalog_record.active then
        raise exception 'O exame deve estar ativo e pertencer à mesma organização da coleta.';
      end if;
    end if;

    if employee_record.sector_id is null then
      raise exception 'O colaborador deve possuir setor para registrar uma coleta.';
    end if;

    select exists (
      select 1
      from public.sector_exam_requirements requirement
      where requirement.organization_id = new.organization_id
        and requirement.sector_id = employee_record.sector_id
        and requirement.exam_id = new.exam_id
        and requirement.active = true
    ) into requirement_exists;

    if not requirement_exists then
      raise exception 'O exame deve estar vinculado ao setor atual do colaborador.';
    end if;
  end if;

  return new;
end;
$$;

revoke all privileges on table public.sector_exam_requirements
from authenticated, anon, public;

grant select, insert, update, delete on table public.sector_exam_requirements
to authenticated;
