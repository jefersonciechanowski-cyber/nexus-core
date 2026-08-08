do $$
begin
  if exists (
    select 1
    from public.exam_records
    where status is not null
      and status not in ('BOM', 'ATENÇÃO', 'CRÍTICO', 'SEM PARÂMETRO')
  ) then
    raise exception 'Não foi possível aplicar a constraint de status: existem registros legados em exam_records com status fora dos valores permitidos. Revise esses registros antes de executar a migration 011.';
  end if;
end;
$$;

alter table public.exam_records
  add column exam_id uuid references public.exam_catalog(id) on delete restrict,
  add column collection_number integer,
  add column measurement_unit_snapshot text,
  add column esocial_reportable_snapshot boolean not null default false,
  add column esocial_procedure_code_snapshot text,
  add column updated_at timestamptz not null default now(),
  add constraint exam_records_collection_number_check
    check (collection_number is null or collection_number > 0),
  add constraint exam_records_esocial_snapshot_check
    check (
      (
        esocial_reportable_snapshot = false
        and esocial_procedure_code_snapshot is null
      )
      or
      (
        esocial_reportable_snapshot = true
        and esocial_procedure_code_snapshot is not null
        and esocial_procedure_code_snapshot ~ '^[0-9]{4}$'
      )
    );

alter table public.exam_records
  add constraint exam_records_status_check
    check (status is null or status in ('BOM', 'ATENÇÃO', 'CRÍTICO', 'SEM PARÂMETRO'));

create unique index exam_records_complete_collection_unique
  on public.exam_records (organization_id, employee_id, exam_id, (extract(year from collected_at)), collection_number)
  where exam_id is not null and collection_number is not null;

create or replace function public.enforce_exam_record_integrity_and_snapshot()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  employee_organization_id uuid;
  catalog_record public.exam_catalog%rowtype;
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
    elsif new.exam_id is null then
      raise exception 'Uma coleta vinculada não pode ficar sem exame.';
    end if;
  end if;

  select organization_id into employee_organization_id
  from public.employees
  where id = new.employee_id;

  if employee_organization_id is null or employee_organization_id <> new.organization_id then
    raise exception 'O colaborador deve pertencer à mesma organização da coleta.';
  end if;

  if tg_op = 'INSERT' and new.exam_id is null then
    raise exception 'Novas coletas exigem exame.';
  end if;

  if new.exam_id is not null and new.collection_number is null then
    raise exception 'Coletas vinculadas a um exame exigem número da coleta.';
  end if;

  if tg_op = 'INSERT' and new.exam_id is not null then
    select * into catalog_record
    from public.exam_catalog
    where id = new.exam_id;

    if not found or catalog_record.organization_id <> new.organization_id then
      raise exception 'O exame deve pertencer à mesma organização da coleta.';
    end if;

    if catalog_record.result_type <> 'NUMERIC' then
      raise exception 'Somente exames numéricos podem ser usados em coletas.';
    end if;

    new.exam_name = catalog_record.name;
    new.measurement_unit_snapshot = catalog_record.measurement_unit;
    new.esocial_reportable_snapshot = catalog_record.esocial_reportable;
    new.esocial_procedure_code_snapshot = catalog_record.esocial_procedure_code;
  elsif tg_op = 'UPDATE' then
    if new.exam_id is distinct from old.exam_id then
      select * into catalog_record
      from public.exam_catalog
      where id = new.exam_id;

      if not found or catalog_record.organization_id <> new.organization_id then
        raise exception 'O exame deve pertencer à mesma organização da coleta.';
      end if;

      if catalog_record.result_type <> 'NUMERIC' then
        raise exception 'Somente exames numéricos podem ser usados em coletas.';
      end if;

      new.exam_name = catalog_record.name;
      new.measurement_unit_snapshot = catalog_record.measurement_unit;
      new.esocial_reportable_snapshot = catalog_record.esocial_reportable;
      new.esocial_procedure_code_snapshot = catalog_record.esocial_procedure_code;
    end if;
  end if;

  return new;
end;
$$;

create trigger exam_records_integrity_and_snapshot
before insert or update on public.exam_records
for each row
execute function public.enforce_exam_record_integrity_and_snapshot();

create or replace function public.set_exam_records_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger exam_records_set_updated_at
before update on public.exam_records
for each row
execute function public.set_exam_records_updated_at();

revoke all privileges on table public.exam_records
from authenticated, anon, public;

grant select, insert, update on table public.exam_records
to authenticated;
