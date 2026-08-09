begin;

create table if not exists public.occurrence_code_counters (
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  code_year integer not null
    constraint occurrence_code_counters_year_check
      check (code_year between 2000 and 9999),
  last_number bigint not null
    constraint occurrence_code_counters_number_check
      check (last_number >= 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id, code_year)
);

alter table public.occurrence_code_counters enable row level security;

revoke all privileges
on table public.occurrence_code_counters
from authenticated, anon, public;

alter table public.occurrences
  add column if not exists occurrence_code text;

-- A migration 018 protege os dados originais por trigger. Retiramos somente
-- esse trigger durante o preenchimento dos códigos dos registros existentes.
drop trigger if exists occurrences_integrity
  on public.occurrences;

with numbered as (
  select
    id,
    organization_id,
    extract(year from occurred_at)::integer as code_year,
    row_number() over (
      partition by organization_id, extract(year from occurred_at)
      order by occurred_at, created_at, id
    ) as code_number
  from public.occurrences
)
update public.occurrences occurrence
set occurrence_code = format(
  'OC-%s-%s',
  numbered.code_year,
  lpad(numbered.code_number::text, 4, '0')
)
from numbered
where occurrence.id = numbered.id
  and occurrence.occurrence_code is null;

insert into public.occurrence_code_counters (
  organization_id,
  code_year,
  last_number,
  updated_at
)
select
  organization_id,
  extract(year from occurred_at)::integer,
  count(*)::bigint,
  now()
from public.occurrences
group by organization_id, extract(year from occurred_at)
on conflict (organization_id, code_year)
do update set
  last_number = greatest(
    public.occurrence_code_counters.last_number,
    excluded.last_number
  ),
  updated_at = now();

alter table public.occurrences
  alter column occurrence_code set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.occurrences'::regclass
      and conname = 'occurrences_code_format_check'
  ) then
    alter table public.occurrences
      add constraint occurrences_code_format_check
      check (occurrence_code ~ '^OC-[0-9]{4}-[0-9]{4,}$');
  end if;
end;
$$;

create unique index if not exists occurrences_org_code_unique
  on public.occurrences (organization_id, occurrence_code);

comment on column public.occurrences.occurrence_code is
  'Código permanente da ocorrência; referência estável para relatórios e futuras não conformidades.';

create or replace function public.enforce_occurrence_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  employee_row public.employees%rowtype;
  occurrence_type_row public.occurrence_types%rowtype;
  occurrence_year integer;
  next_number bigint;
begin
  if auth.uid() is null then
    raise exception 'É necessário estar autenticado para registrar ou cancelar ocorrências.';
  end if;

  if new.organization_id <> public.current_org_id()
     and not public.is_nexus_admin() then
    raise exception 'A ocorrência deve pertencer à organização do usuário autenticado.';
  end if;

  new.description = btrim(new.description);
  new.cancel_reason = nullif(btrim(new.cancel_reason), '');

  if tg_op = 'UPDATE' then
    if old.status = 'CANCELLED' then
      raise exception 'Uma ocorrência cancelada não pode ser alterada.';
    end if;

    if new.id is distinct from old.id
       or new.organization_id is distinct from old.organization_id
       or new.occurrence_code is distinct from old.occurrence_code
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

  occurrence_year = extract(year from new.occurred_at)::integer;

  insert into public.occurrence_code_counters (
    organization_id,
    code_year,
    last_number,
    updated_at
  ) values (
    new.organization_id,
    occurrence_year,
    1,
    now()
  )
  on conflict (organization_id, code_year)
  do update set
    last_number = public.occurrence_code_counters.last_number + 1,
    updated_at = now()
  returning last_number into next_number;

  new.occurrence_code = format(
    'OC-%s-%s',
    occurrence_year,
    lpad(next_number::text, 4, '0')
  );
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
set search_path = public, pg_temp
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
      when tg_op = 'INSERT' then 'OCCURRENCE_CREATED'
      else 'OCCURRENCE_CANCELLED'
    end,
    'occurrences',
    new.id::text,
    jsonb_build_object(
      'occurrence_code', new.occurrence_code,
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

commit;
