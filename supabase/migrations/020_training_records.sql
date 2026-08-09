begin;

create table if not exists public.training_record_code_counters (
  organization_id uuid not null
    references public.organizations(id) on delete cascade,
  code_year integer not null
    constraint training_record_code_counters_year_check
      check (code_year between 2000 and 9999),
  last_number bigint not null
    constraint training_record_code_counters_number_check
      check (last_number >= 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id, code_year)
);

alter table public.training_record_code_counters enable row level security;

revoke all privileges
on table public.training_record_code_counters
from authenticated, anon, public;

alter table public.training_records
  add column if not exists record_code text,
  add column if not exists training_type_id uuid,
  add column if not exists unit_id uuid,
  add column if not exists sector_id uuid,
  add column if not exists job_role_id uuid,
  add column if not exists matrix_rule_id uuid,
  add column if not exists applied_validity_days integer,
  add column if not exists certificate_number text,
  add column if not exists instructor_name text,
  add column if not exists instructor_entity text,
  add column if not exists instructor_document text,
  add column if not exists workload_hours numeric(7,2),
  add column if not exists modality text,
  add column if not exists training_location text,
  add column if not exists program_content text,
  add column if not exists notes text,
  add column if not exists status text not null default 'COMPLETED',
  add column if not exists created_by uuid references auth.users(id) on delete set null default auth.uid(),
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists cancelled_by uuid references auth.users(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.training_records'::regclass
      and conname = 'training_records_employee_id_fkey'
  ) then
    alter table public.training_records
      drop constraint training_records_employee_id_fkey;
  end if;

  alter table public.training_records
    add constraint training_records_employee_id_fkey
    foreign key (employee_id) references public.employees(id) on delete restrict;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.training_records'::regclass
      and conname = 'training_records_training_type_id_fkey'
  ) then
    alter table public.training_records
      add constraint training_records_training_type_id_fkey
      foreign key (training_type_id) references public.training_catalog(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.training_records'::regclass
      and conname = 'training_records_unit_id_fkey'
  ) then
    alter table public.training_records
      add constraint training_records_unit_id_fkey
      foreign key (unit_id) references public.units(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.training_records'::regclass
      and conname = 'training_records_sector_id_fkey'
  ) then
    alter table public.training_records
      add constraint training_records_sector_id_fkey
      foreign key (sector_id) references public.sectors(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.training_records'::regclass
      and conname = 'training_records_job_role_id_fkey'
  ) then
    alter table public.training_records
      add constraint training_records_job_role_id_fkey
      foreign key (job_role_id) references public.job_roles(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.training_records'::regclass
      and conname = 'training_records_matrix_rule_id_fkey'
  ) then
    alter table public.training_records
      add constraint training_records_matrix_rule_id_fkey
      foreign key (matrix_rule_id) references public.control_matrix_rules(id) on delete restrict;
  end if;
end;
$$;

-- Registros antigos são ligados ao catálogo pelo nome sem apagar o histórico.
insert into public.training_catalog (
  organization_id,
  name,
  validity_days,
  requires_certificate,
  active
)
select
  record.organization_id,
  coalesce(nullif(btrim(record.training_name), ''), 'Treinamento legado'),
  max(
    case
      when record.expires_at is not null and record.expires_at > record.completed_at
        then record.expires_at - record.completed_at
      else null
    end
  ),
  bool_or(record.certificate_path is not null),
  false
from public.training_records record
where not exists (
  select 1
  from public.training_catalog catalog
  where catalog.organization_id = record.organization_id
    and lower(btrim(catalog.name)) = lower(
      coalesce(nullif(btrim(record.training_name), ''), 'Treinamento legado')
    )
)
group by
  record.organization_id,
  coalesce(nullif(btrim(record.training_name), ''), 'Treinamento legado');

update public.training_records record
set training_type_id = catalog.id
from public.training_catalog catalog
where record.training_type_id is null
  and catalog.organization_id = record.organization_id
  and lower(btrim(catalog.name)) = lower(
    coalesce(nullif(btrim(record.training_name), ''), 'Treinamento legado')
  );

update public.training_records record
set
  unit_id = coalesce(record.unit_id, employee.unit_id),
  sector_id = coalesce(record.sector_id, employee.sector_id),
  job_role_id = coalesce(record.job_role_id, employee.job_role_id)
from public.employees employee
where employee.id = record.employee_id
  and employee.organization_id = record.organization_id
  and (
    record.unit_id is null
    or record.sector_id is null
    or record.job_role_id is null
  );

update public.training_records record
set matrix_rule_id = (
  select rule.id
  from public.control_matrix_rules rule
  where rule.organization_id = record.organization_id
    and rule.requirement_type = 'TRAINING'
    and rule.training_id = record.training_type_id
    and (rule.unit_id is null or rule.unit_id = record.unit_id)
    and (rule.sector_id is null or rule.sector_id = record.sector_id)
    and (rule.job_role_id is null or rule.job_role_id = record.job_role_id)
    and (rule.effective_from is null or rule.effective_from <= record.completed_at)
  order by
    rule.active desc,
    ((rule.unit_id is not null)::integer
      + (rule.sector_id is not null)::integer
      + (rule.job_role_id is not null)::integer) desc,
    rule.effective_from desc nulls last,
    rule.created_at desc
  limit 1
)
where record.matrix_rule_id is null;

update public.training_records record
set applied_validity_days = coalesce(
  record.applied_validity_days,
  case
    when record.expires_at is not null and record.expires_at > record.completed_at
      then record.expires_at - record.completed_at
  end,
  (
    select nullif(rule.validity_days, 0)
    from public.control_matrix_rules rule
    where rule.id = record.matrix_rule_id
  ),
  (
    select catalog.validity_days
    from public.training_catalog catalog
    where catalog.id = record.training_type_id
  )
)
where record.applied_validity_days is null;

update public.training_records
set expires_at = completed_at + applied_validity_days
where expires_at is null
  and applied_validity_days is not null;

update public.training_records
set
  status = 'COMPLETED',
  instructor_name = coalesce(nullif(btrim(instructor_name), ''), 'Não informado'),
  modality = coalesce(nullif(upper(btrim(modality)), ''), 'IN_PERSON'),
  workload_hours = coalesce(workload_hours, 1),
  updated_at = coalesce(updated_at, created_at, now());

with numbered as (
  select
    id,
    organization_id,
    extract(year from completed_at)::integer as code_year,
    row_number() over (
      partition by organization_id, extract(year from completed_at)
      order by completed_at, created_at, id
    ) as code_number
  from public.training_records
)
update public.training_records record
set record_code = format(
  'TR-%s-%s',
  numbered.code_year,
  lpad(numbered.code_number::text, 4, '0')
)
from numbered
where record.id = numbered.id
  and record.record_code is null;

insert into public.training_record_code_counters (
  organization_id,
  code_year,
  last_number,
  updated_at
)
select
  organization_id,
  extract(year from completed_at)::integer,
  count(*)::bigint,
  now()
from public.training_records
group by organization_id, extract(year from completed_at)
on conflict (organization_id, code_year)
do update set
  last_number = greatest(
    public.training_record_code_counters.last_number,
    excluded.last_number
  ),
  updated_at = now();

alter table public.training_records
  alter column record_code set not null,
  alter column training_type_id set not null;

do $$
declare
  constraint_row record;
begin
  for constraint_row in
    select conname
    from pg_constraint
    where conrelid = 'public.training_records'::regclass
      and contype = 'c'
      and (
        pg_get_constraintdef(oid) ilike '%status%'
        or pg_get_constraintdef(oid) ilike '%modality%'
        or pg_get_constraintdef(oid) ilike '%workload_hours%'
        or pg_get_constraintdef(oid) ilike '%applied_validity_days%'
        or pg_get_constraintdef(oid) ilike '%cancel_reason%'
        or pg_get_constraintdef(oid) ilike '%record_code%'
      )
  loop
    execute format(
      'alter table public.training_records drop constraint %I',
      constraint_row.conname
    );
  end loop;
end;
$$;

alter table public.training_records
  add constraint training_records_code_format_check
    check (record_code ~ '^TR-[0-9]{4}-[0-9]{4,}$'),
  add constraint training_records_status_check
    check (status in ('COMPLETED', 'CANCELLED')),
  add constraint training_records_modality_check
    check (modality in ('IN_PERSON', 'ONLINE', 'HYBRID')),
  add constraint training_records_workload_check
    check (workload_hours > 0),
  add constraint training_records_validity_check
    check (applied_validity_days is null or applied_validity_days > 0),
  add constraint training_records_dates_check
    check (expires_at is null or expires_at > completed_at),
  add constraint training_records_instructor_check
    check (nullif(btrim(instructor_name), '') is not null),
  add constraint training_records_complete_context_check
    check (
      unit_id is not null
      and sector_id is not null
      and job_role_id is not null
      and matrix_rule_id is not null
      and applied_validity_days is not null
    ) not valid,
  add constraint training_records_cancelled_fields_check
    check (
      (
        status = 'COMPLETED'
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
    ) not valid;

create unique index if not exists training_records_org_code_unique
  on public.training_records (organization_id, record_code);

create index if not exists training_records_org_employee_date_idx
  on public.training_records (
    organization_id,
    employee_id,
    completed_at desc,
    created_at desc
  );

create index if not exists training_records_org_type_status_idx
  on public.training_records (
    organization_id,
    training_type_id,
    status,
    expires_at
  );

comment on column public.training_records.record_code is
  'Código permanente do registro de treinamento e futura referência do certificado.';

comment on column public.training_records.certificate_path is
  'Caminho da evidência ou do certificado armazenado; o arquivo será tratado pela etapa documental.';

create or replace function public.enforce_training_record_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  employee_row public.employees%rowtype;
  training_row public.training_catalog%rowtype;
  matrix_row public.control_matrix_rules%rowtype;
  record_year integer;
  next_number bigint;
begin
  if auth.uid() is null then
    raise exception 'É necessário estar autenticado para registrar ou cancelar treinamentos.';
  end if;

  if not coalesce(public.is_nexus_admin(), false)
     and (
       public.current_org_id() is null
       or new.organization_id is distinct from public.current_org_id()
     ) then
    raise exception 'O treinamento deve pertencer à organização do usuário autenticado.';
  end if;

  new.certificate_number = nullif(btrim(new.certificate_number), '');
  new.instructor_name = nullif(btrim(new.instructor_name), '');
  new.instructor_entity = nullif(btrim(new.instructor_entity), '');
  new.instructor_document = nullif(btrim(new.instructor_document), '');
  new.training_location = nullif(btrim(new.training_location), '');
  new.program_content = nullif(btrim(new.program_content), '');
  new.notes = nullif(btrim(new.notes), '');
  new.cancel_reason = nullif(btrim(new.cancel_reason), '');
  new.modality = upper(btrim(new.modality));

  if tg_op = 'UPDATE' then
    if old.status = 'CANCELLED' then
      raise exception 'Um treinamento cancelado não pode ser alterado.';
    end if;

    if new.id is distinct from old.id
       or new.organization_id is distinct from old.organization_id
       or new.record_code is distinct from old.record_code
       or new.employee_id is distinct from old.employee_id
       or new.training_type_id is distinct from old.training_type_id
       or new.training_name is distinct from old.training_name
       or new.unit_id is distinct from old.unit_id
       or new.sector_id is distinct from old.sector_id
       or new.job_role_id is distinct from old.job_role_id
       or new.matrix_rule_id is distinct from old.matrix_rule_id
       or new.applied_validity_days is distinct from old.applied_validity_days
       or new.completed_at is distinct from old.completed_at
       or new.expires_at is distinct from old.expires_at
       or new.certificate_number is distinct from old.certificate_number
       or new.certificate_path is distinct from old.certificate_path
       or new.instructor_name is distinct from old.instructor_name
       or new.instructor_entity is distinct from old.instructor_entity
       or new.instructor_document is distinct from old.instructor_document
       or new.workload_hours is distinct from old.workload_hours
       or new.modality is distinct from old.modality
       or new.training_location is distinct from old.training_location
       or new.program_content is distinct from old.program_content
       or new.notes is distinct from old.notes
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Os dados originais do treinamento não podem ser alterados.';
    end if;

    if new.status <> 'CANCELLED' or new.cancel_reason is null then
      raise exception 'Informe o motivo para cancelar o treinamento.';
    end if;

    new.cancelled_at = now();
    new.cancelled_by = auth.uid();
    new.updated_at = now();
    return new;
  end if;

  if new.completed_at > current_date then
    raise exception 'A realização do treinamento não pode ser registrada em data futura.';
  end if;

  if new.workload_hours is null or new.workload_hours <= 0 then
    raise exception 'Informe uma carga horária válida para o treinamento.';
  end if;

  if new.instructor_name is null then
    raise exception 'Informe o instrutor ou responsável pelo treinamento.';
  end if;

  if new.modality is null
     or new.modality not in ('IN_PERSON', 'ONLINE', 'HYBRID') then
    raise exception 'Informe uma modalidade válida para o treinamento.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      new.organization_id::text || ':'
      || new.employee_id::text || ':'
      || new.training_type_id::text || ':'
      || new.completed_at::text,
      0
    )
  );

  select * into employee_row
  from public.employees
  where id = new.employee_id;

  if employee_row.id is null
     or employee_row.organization_id <> new.organization_id then
    raise exception 'O colaborador deve pertencer à mesma organização do treinamento.';
  end if;

  if not employee_row.active then
    raise exception 'Somente colaboradores ativos podem receber novos registros de treinamento.';
  end if;

  if employee_row.unit_id is null
     or employee_row.sector_id is null
     or employee_row.job_role_id is null then
    raise exception 'O colaborador precisa possuir unidade, setor e função cadastrados.';
  end if;

  select * into training_row
  from public.training_catalog
  where id = new.training_type_id;

  if training_row.id is null
     or training_row.organization_id <> new.organization_id then
    raise exception 'O tipo de treinamento deve pertencer à mesma organização.';
  end if;

  if not training_row.active then
    raise exception 'Selecione um tipo de treinamento ativo.';
  end if;

  select * into matrix_row
  from public.control_matrix_rules rule
  where rule.organization_id = new.organization_id
    and rule.active = true
    and rule.requirement_type = 'TRAINING'
    and rule.training_id = new.training_type_id
    and (rule.unit_id is null or rule.unit_id = employee_row.unit_id)
    and (rule.sector_id is null or rule.sector_id = employee_row.sector_id)
    and (rule.job_role_id is null or rule.job_role_id = employee_row.job_role_id)
    and (rule.effective_from is null or rule.effective_from <= new.completed_at)
  order by
    ((rule.unit_id is not null)::integer
      + (rule.sector_id is not null)::integer
      + (rule.job_role_id is not null)::integer) desc,
    rule.effective_from desc nulls last,
    rule.created_at desc
  limit 1;

  if matrix_row.id is null then
    raise exception 'Não existe uma regra ativa da Matriz para este treinamento e colaborador.';
  end if;

  new.applied_validity_days = coalesce(
    nullif(matrix_row.validity_days, 0),
    training_row.validity_days
  );

  if new.applied_validity_days is null or new.applied_validity_days <= 0 then
    raise exception 'Defina uma validade positiva no treinamento ou na Matriz de Controle.';
  end if;

  if exists (
    select 1
    from public.training_records record
    where record.organization_id = new.organization_id
      and record.employee_id = new.employee_id
      and record.training_type_id = new.training_type_id
      and record.completed_at = new.completed_at
      and record.status = 'COMPLETED'
  ) then
    raise exception 'Este treinamento já foi registrado para o colaborador na data informada.';
  end if;

  record_year = extract(year from new.completed_at)::integer;

  insert into public.training_record_code_counters (
    organization_id,
    code_year,
    last_number,
    updated_at
  ) values (
    new.organization_id,
    record_year,
    1,
    now()
  )
  on conflict (organization_id, code_year)
  do update set
    last_number = public.training_record_code_counters.last_number + 1,
    updated_at = now()
  returning last_number into next_number;

  new.record_code = format(
    'TR-%s-%s',
    record_year,
    lpad(next_number::text, 4, '0')
  );
  new.training_name = training_row.name;
  new.unit_id = employee_row.unit_id;
  new.sector_id = employee_row.sector_id;
  new.job_role_id = employee_row.job_role_id;
  new.matrix_rule_id = matrix_row.id;
  new.expires_at = new.completed_at + new.applied_validity_days;
  new.status = 'COMPLETED';
  new.created_by = auth.uid();
  new.cancelled_at = null;
  new.cancel_reason = null;
  new.cancelled_by = null;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists training_records_integrity
  on public.training_records;

create trigger training_records_integrity
before insert or update on public.training_records
for each row
execute function public.enforce_training_record_integrity();

create or replace function public.audit_training_record_change()
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
      when tg_op = 'INSERT' then 'TRAINING_RECORDED'
      else 'TRAINING_CANCELLED'
    end,
    'training_records',
    new.id::text,
    jsonb_build_object(
      'record_code', new.record_code,
      'employee_id', new.employee_id,
      'training_type_id', new.training_type_id,
      'training_name', new.training_name,
      'completed_at', new.completed_at,
      'expires_at', new.expires_at,
      'workload_hours', new.workload_hours,
      'status', new.status,
      'cancel_reason', new.cancel_reason
    )
  );
  return new;
end;
$$;

drop trigger if exists training_records_audit
  on public.training_records;

create trigger training_records_audit
after insert or update of status on public.training_records
for each row
execute function public.audit_training_record_change();

revoke execute on function public.enforce_training_record_integrity()
from public, authenticated, anon;

revoke execute on function public.audit_training_record_change()
from public, authenticated, anon;

alter table public.training_records enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'training_records'
      and cmd = 'SELECT'
  ) then
    create policy "training records tenant select"
      on public.training_records for select
      using (organization_id = public.current_org_id() or public.is_nexus_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'training_records'
      and cmd = 'INSERT'
  ) then
    create policy "training records tenant insert"
      on public.training_records for insert
      with check (organization_id = public.current_org_id() or public.is_nexus_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'training_records'
      and cmd = 'UPDATE'
  ) then
    create policy "training records tenant update"
      on public.training_records for update
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
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'training_records'
      and cmd = 'DELETE'
  loop
    execute format(
      'drop policy %I on public.training_records',
      policy_row.policyname
    );
  end loop;
end;
$$;

revoke all privileges on table public.training_records
from authenticated, anon, public;

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
  notes
) on public.training_records to authenticated;

grant update (
  status,
  cancel_reason
) on public.training_records to authenticated;

commit;
