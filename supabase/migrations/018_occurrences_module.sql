begin;

create table if not exists public.occurrence_types (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint occurrence_types_name_check
    check (nullif(btrim(name), '') is not null)
);

create unique index if not exists occurrence_types_org_active_name_unique
  on public.occurrence_types (organization_id, lower(btrim(name)))
  where active = true;

create index if not exists occurrence_types_org_name_idx
  on public.occurrence_types (organization_id, name);

alter table public.occurrences
  add column if not exists occurrence_type_id uuid,
  add column if not exists unit_id uuid,
  add column if not exists sector_id uuid,
  add column if not exists created_by uuid references auth.users(id) on delete set null default auth.uid(),
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.occurrences'::regclass
      and conname = 'occurrences_employee_id_fkey'
  ) then
    alter table public.occurrences
      drop constraint occurrences_employee_id_fkey;
  end if;

  alter table public.occurrences
    add constraint occurrences_employee_id_fkey
    foreign key (employee_id) references public.employees(id) on delete restrict;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.occurrences'::regclass
      and conname = 'occurrences_occurrence_type_id_fkey'
  ) then
    alter table public.occurrences
      add constraint occurrences_occurrence_type_id_fkey
      foreign key (occurrence_type_id)
      references public.occurrence_types(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.occurrences'::regclass
      and conname = 'occurrences_unit_id_fkey'
  ) then
    alter table public.occurrences
      add constraint occurrences_unit_id_fkey
      foreign key (unit_id) references public.units(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.occurrences'::regclass
      and conname = 'occurrences_sector_id_fkey'
  ) then
    alter table public.occurrences
      add constraint occurrences_sector_id_fkey
      foreign key (sector_id) references public.sectors(id) on delete restrict;
  end if;
end;
$$;

-- Preserva os tipos já usados pelos registros antigos e os transforma em catálogo.
insert into public.occurrence_types (organization_id, name, active)
select distinct
  occurrence.organization_id,
  coalesce(nullif(btrim(occurrence.occurrence_type), ''), 'Ocorrência legada'),
  true
from public.occurrences occurrence
where not exists (
  select 1
  from public.occurrence_types occurrence_type
  where occurrence_type.organization_id = occurrence.organization_id
    and lower(btrim(occurrence_type.name)) = lower(
      coalesce(nullif(btrim(occurrence.occurrence_type), ''), 'Ocorrência legada')
    )
);

update public.occurrences occurrence
set occurrence_type_id = occurrence_type.id
from public.occurrence_types occurrence_type
where occurrence.occurrence_type_id is null
  and occurrence_type.organization_id = occurrence.organization_id
  and lower(btrim(occurrence_type.name)) = lower(
    coalesce(nullif(btrim(occurrence.occurrence_type), ''), 'Ocorrência legada')
  );

update public.occurrences occurrence
set
  unit_id = coalesce(occurrence.unit_id, employee.unit_id),
  sector_id = coalesce(occurrence.sector_id, employee.sector_id)
from public.employees employee
where employee.id = occurrence.employee_id
  and employee.organization_id = occurrence.organization_id
  and (occurrence.unit_id is null or occurrence.sector_id is null);

update public.occurrences
set severity = case
  when upper(coalesce(severity, '')) like '%BAIX%' then 'LOW'
  when upper(coalesce(severity, '')) like '%MÉD%' then 'MEDIUM'
  when upper(coalesce(severity, '')) like '%MED%' then 'MEDIUM'
  when upper(coalesce(severity, '')) like '%CRÍ%' then 'HIGH'
  when upper(coalesce(severity, '')) like '%CRIT%' then 'HIGH'
  when upper(coalesce(severity, '')) like '%ALT%' then 'HIGH'
  when upper(coalesce(severity, '')) in ('LOW', 'MEDIUM', 'HIGH') then upper(severity)
  else 'MEDIUM'
end;

update public.occurrences
set status = case
  when upper(coalesce(status, '')) = 'CANCELLED' then 'CANCELLED'
  else 'OPEN'
end;

alter table public.occurrences
  alter column status set default 'OPEN';

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.occurrences'::regclass
      and contype = 'c'
      and (
        pg_get_constraintdef(oid) ilike '%severity%'
        or pg_get_constraintdef(oid) ilike '%status%'
        or pg_get_constraintdef(oid) ilike '%cancel_reason%'
      )
  loop
    execute format(
      'alter table public.occurrences drop constraint %I',
      constraint_row.conname
    );
  end loop;
end;
$$;

alter table public.occurrences
  add constraint occurrences_severity_check
    check (severity in ('LOW', 'MEDIUM', 'HIGH')),
  add constraint occurrences_status_check
    check (status in ('OPEN', 'CANCELLED')),
  add constraint occurrences_description_check
    check (nullif(btrim(description), '') is not null),
  add constraint occurrences_cancelled_fields_check
    check (
      (
        status = 'OPEN'
        and cancelled_at is null
        and cancel_reason is null
        and cancelled_by is null
      )
      or
      (
        status = 'CANCELLED'
        and cancelled_at is not null
        and nullif(btrim(cancel_reason), '') is not null
        and cancelled_by is not null
      )
    ) not valid,
  add constraint occurrences_complete_context_check
    check (
      employee_id is not null
      and occurrence_type_id is not null
      and unit_id is not null
      and sector_id is not null
    ) not valid;

create index if not exists occurrences_org_occurred_at_idx
  on public.occurrences (organization_id, occurred_at desc, created_at desc);

create index if not exists occurrences_org_employee_idx
  on public.occurrences (organization_id, employee_id, occurred_at desc);

create index if not exists occurrences_org_status_severity_idx
  on public.occurrences (organization_id, status, severity, occurred_at desc);

create or replace function public.enforce_occurrence_type_integrity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name = btrim(new.name);

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.organization_id is distinct from old.organization_id
       or new.name is distinct from old.name
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Os dados originais do tipo de ocorrência não podem ser alterados.';
    end if;
  end if;

  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists occurrence_types_integrity
  on public.occurrence_types;

create trigger occurrence_types_integrity
before insert or update on public.occurrence_types
for each row
execute function public.enforce_occurrence_type_integrity();

create or replace function public.audit_occurrence_type_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (
    organization_id,
    user_id,
    action,
    entity,
    entity_id,
    metadata
  ) values (
    new.organization_id,
    auth.uid(),
    case
      when tg_op = 'INSERT' then 'OCCURRENCE_TYPE_CREATED'
      else 'OCCURRENCE_TYPE_DEACTIVATED'
    end,
    'occurrence_types',
    new.id::text,
    jsonb_build_object('name', new.name, 'active', new.active)
  );
  return new;
end;
$$;

drop trigger if exists occurrence_types_audit
  on public.occurrence_types;

create trigger occurrence_types_audit
after insert or update of active on public.occurrence_types
for each row
execute function public.audit_occurrence_type_change();

create or replace function public.enforce_occurrence_integrity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  employee_row public.employees%rowtype;
  occurrence_type_row public.occurrence_types%rowtype;
begin
  new.description = btrim(new.description);
  new.cancel_reason = nullif(btrim(new.cancel_reason), '');

  if tg_op = 'UPDATE' then
    if old.status = 'CANCELLED' then
      raise exception 'Uma ocorrência cancelada não pode ser alterada.';
    end if;

    if new.id is distinct from old.id
       or new.organization_id is distinct from old.organization_id
       or new.employee_id is distinct from old.employee_id
       or new.occurrence_type_id is distinct from old.occurrence_type_id
       or new.occurrence_type is distinct from old.occurrence_type
       or new.unit_id is distinct from old.unit_id
       or new.sector_id is distinct from old.sector_id
       or new.severity is distinct from old.severity
       or new.description is distinct from old.description
       or new.occurred_at is distinct from old.occurred_at
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Os dados originais da ocorrência não podem ser alterados.';
    end if;

    if new.status <> 'CANCELLED' or new.cancel_reason is null then
      raise exception 'Informe o motivo para cancelar a ocorrência.';
    end if;

    new.cancelled_at = now();
    new.cancelled_by = auth.uid();
    new.updated_at = now();
    return new;
  end if;

  if new.occurred_at > current_date then
    raise exception 'A ocorrência não pode ser registrada em data futura.';
  end if;

  select * into employee_row
  from public.employees
  where id = new.employee_id;

  if employee_row.id is null
     or employee_row.organization_id <> new.organization_id then
    raise exception 'O colaborador deve pertencer à mesma organização da ocorrência.';
  end if;

  if not employee_row.active then
    raise exception 'Somente colaboradores ativos podem receber novas ocorrências.';
  end if;

  if employee_row.unit_id is null or employee_row.sector_id is null then
    raise exception 'O colaborador precisa possuir unidade e setor cadastrados.';
  end if;

  select * into occurrence_type_row
  from public.occurrence_types
  where id = new.occurrence_type_id;

  if occurrence_type_row.id is null
     or occurrence_type_row.organization_id <> new.organization_id then
    raise exception 'O tipo deve pertencer à mesma organização da ocorrência.';
  end if;

  if not occurrence_type_row.active then
    raise exception 'Selecione um tipo de ocorrência ativo.';
  end if;

  new.unit_id = employee_row.unit_id;
  new.sector_id = employee_row.sector_id;
  new.occurrence_type = occurrence_type_row.name;
  new.status = 'OPEN';
  new.created_by = auth.uid();
  new.cancelled_at = null;
  new.cancel_reason = null;
  new.cancelled_by = null;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists occurrences_integrity
  on public.occurrences;

create trigger occurrences_integrity
before insert or update on public.occurrences
for each row
execute function public.enforce_occurrence_integrity();

create or replace function public.audit_occurrence_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.audit_logs (
    organization_id,
    user_id,
    action,
    entity,
    entity_id,
    metadata
  ) values (
    new.organization_id,
    auth.uid(),
    case when tg_op = 'INSERT' then 'OCCURRENCE_CREATED' else 'OCCURRENCE_CANCELLED' end,
    'occurrences',
    new.id::text,
    jsonb_build_object(
      'employee_id', new.employee_id,
      'occurrence_type_id', new.occurrence_type_id,
      'severity', new.severity,
      'status', new.status,
      'occurred_at', new.occurred_at,
      'cancel_reason', new.cancel_reason
    )
  );
  return new;
end;
$$;

drop trigger if exists occurrences_audit
  on public.occurrences;

create trigger occurrences_audit
after insert or update of status on public.occurrences
for each row
execute function public.audit_occurrence_change();

alter table public.occurrence_types enable row level security;
alter table public.occurrences enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'occurrence_types'
      and cmd = 'SELECT'
  ) then
    create policy "occurrence types tenant select"
      on public.occurrence_types for select
      using (organization_id = public.current_org_id() or public.is_nexus_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'occurrence_types'
      and cmd = 'INSERT'
  ) then
    create policy "occurrence types tenant insert"
      on public.occurrence_types for insert
      with check (organization_id = public.current_org_id() or public.is_nexus_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'occurrence_types'
      and cmd = 'UPDATE'
  ) then
    create policy "occurrence types tenant update"
      on public.occurrence_types for update
      using (organization_id = public.current_org_id() or public.is_nexus_admin())
      with check (organization_id = public.current_org_id() or public.is_nexus_admin());
  end if;
end;
$$;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('occurrence_types', 'occurrences')
      and cmd = 'DELETE'
  loop
    execute format(
      'drop policy %I on public.%I',
      policy_row.policyname,
      policy_row.tablename
    );
  end loop;
end;
$$;

revoke all privileges on table public.occurrence_types, public.occurrences
from authenticated, anon, public;

grant select on table public.occurrence_types, public.occurrences
to authenticated;

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

commit;
