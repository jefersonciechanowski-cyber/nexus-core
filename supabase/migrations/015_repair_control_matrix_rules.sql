begin;

do $$
begin
  if to_regclass('public.control_matrix_rules') is null then
    raise exception 'Operação cancelada: a tabela public.control_matrix_rules não existe.';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'control_matrix_rules'
      and column_name = 'effective_to'
  ) and exists (
    select 1
    from public.control_matrix_rules
  ) then
    raise exception
      'Operação cancelada: a estrutura antiga contém registros e exige migração assistida.';
  end if;
end;
$$;

alter table public.control_matrix_rules
  add column if not exists unit_id uuid,
  add column if not exists exam_id uuid,
  add column if not exists training_id uuid,
  add column if not exists epi_id uuid,
  add column if not exists effective_from date,
  add column if not exists active boolean not null default true,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.control_matrix_rules'::regclass
      and conname = 'control_matrix_rules_unit_id_fkey'
  ) then
    alter table public.control_matrix_rules
      add constraint control_matrix_rules_unit_id_fkey
      foreign key (unit_id) references public.units(id) on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.control_matrix_rules'::regclass
      and conname = 'control_matrix_rules_exam_id_fkey'
  ) then
    alter table public.control_matrix_rules
      add constraint control_matrix_rules_exam_id_fkey
      foreign key (exam_id) references public.exam_catalog(id) on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.control_matrix_rules'::regclass
      and conname = 'control_matrix_rules_training_id_fkey'
  ) then
    alter table public.control_matrix_rules
      add constraint control_matrix_rules_training_id_fkey
      foreign key (training_id) references public.training_catalog(id) on delete restrict;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.control_matrix_rules'::regclass
      and conname = 'control_matrix_rules_epi_id_fkey'
  ) then
    alter table public.control_matrix_rules
      add constraint control_matrix_rules_epi_id_fkey
      foreign key (epi_id) references public.epi_catalog(id) on delete restrict;
  end if;
end;
$$;

alter table public.control_matrix_rules
  drop column if exists effective_to;

do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select conname
    from pg_constraint
    where conrelid = 'public.control_matrix_rules'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%requirement_type%'
  loop
    execute format(
      'alter table public.control_matrix_rules drop constraint %I',
      v_constraint.conname
    );
  end loop;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.control_matrix_rules'::regclass
      and conname = 'control_matrix_rules_type_check'
  ) then
    alter table public.control_matrix_rules
      add constraint control_matrix_rules_type_check
      check (requirement_type in ('EXAM', 'TRAINING', 'EPI', 'DOCUMENT', 'RISK'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.control_matrix_rules'::regclass
      and conname = 'control_matrix_rules_name_check'
  ) then
    alter table public.control_matrix_rules
      add constraint control_matrix_rules_name_check
      check (nullif(btrim(requirement_name), '') is not null);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.control_matrix_rules'::regclass
      and conname = 'control_matrix_rules_validity_check'
  ) then
    alter table public.control_matrix_rules
      add constraint control_matrix_rules_validity_check
      check (validity_days >= 0);
  end if;

  alter table public.control_matrix_rules
    add constraint control_matrix_rules_registered_item_check
    check (
      (requirement_type = 'EXAM' and exam_id is not null and training_id is null and epi_id is null)
      or
      (requirement_type = 'TRAINING' and exam_id is null and training_id is not null and epi_id is null)
      or
      (requirement_type = 'EPI' and exam_id is null and training_id is null and epi_id is not null)
      or
      (requirement_type in ('DOCUMENT', 'RISK') and exam_id is null and training_id is null and epi_id is null)
    );

  alter table public.control_matrix_rules
    add constraint control_matrix_rules_epi_context_check
    check (
      requirement_type <> 'EPI'
      or (
        unit_id is not null
        and sector_id is not null
        and job_role_id is not null
        and validity_days > 0
      )
    );
end;
$$;

create index if not exists control_matrix_rules_org_active_idx
  on public.control_matrix_rules (
    organization_id,
    requirement_type,
    unit_id,
    sector_id,
    job_role_id
  )
  where active = true;

create unique index if not exists control_matrix_rules_active_context_unique
  on public.control_matrix_rules (
    organization_id,
    coalesce(unit_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(sector_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(job_role_id, '00000000-0000-0000-0000-000000000000'::uuid),
    requirement_type,
    coalesce(exam_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(training_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(epi_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(requirement_name)
  )
  where active = true;

alter table public.control_matrix_rules enable row level security;

create or replace function public.enforce_control_matrix_rule_integrity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  referenced_organization_id uuid;
  referenced_active boolean;
  sector_unit_id uuid;
begin
  new.requirement_name = btrim(new.requirement_name);
  new.requirement_type = upper(btrim(new.requirement_type));

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'O identificador da regra da Matriz não pode ser alterado.';
    end if;

    if new.organization_id is distinct from old.organization_id then
      raise exception 'A organização da regra da Matriz não pode ser alterada.';
    end if;

    if new.created_at is distinct from old.created_at then
      raise exception 'A data de criação da regra da Matriz não pode ser alterada.';
    end if;
  end if;

  if new.unit_id is not null then
    select organization_id
      into referenced_organization_id
    from public.units
    where id = new.unit_id;

    if referenced_organization_id is null
       or referenced_organization_id <> new.organization_id then
      raise exception 'A unidade da regra deve pertencer à mesma organização.';
    end if;
  end if;

  if new.sector_id is not null then
    select organization_id, unit_id
      into referenced_organization_id, sector_unit_id
    from public.sectors
    where id = new.sector_id;

    if referenced_organization_id is null
       or referenced_organization_id <> new.organization_id then
      raise exception 'O setor da regra deve pertencer à mesma organização.';
    end if;

    if new.unit_id is null or sector_unit_id <> new.unit_id then
      raise exception 'O setor da regra deve pertencer à unidade selecionada.';
    end if;
  end if;

  if new.job_role_id is not null then
    select organization_id
      into referenced_organization_id
    from public.job_roles
    where id = new.job_role_id;

    if referenced_organization_id is null
       or referenced_organization_id <> new.organization_id then
      raise exception 'A função da regra deve pertencer à mesma organização.';
    end if;
  end if;

  if new.requirement_type = 'EPI' then
    select organization_id, active
      into referenced_organization_id, referenced_active
    from public.epi_catalog
    where id = new.epi_id;

    if referenced_organization_id is null
       or referenced_organization_id <> new.organization_id then
      raise exception 'O EPI da regra deve pertencer à mesma organização.';
    end if;

    if new.active and not referenced_active then
      raise exception 'Somente EPIs ativos podem ser vinculados à Matriz.';
    end if;
  elsif new.requirement_type = 'EXAM' then
    select organization_id, active
      into referenced_organization_id, referenced_active
    from public.exam_catalog
    where id = new.exam_id;

    if referenced_organization_id is null
       or referenced_organization_id <> new.organization_id then
      raise exception 'O exame da regra deve pertencer à mesma organização.';
    end if;

    if new.active and not referenced_active then
      raise exception 'Somente exames ativos podem ser vinculados à Matriz.';
    end if;
  elsif new.requirement_type = 'TRAINING' then
    select organization_id, active
      into referenced_organization_id, referenced_active
    from public.training_catalog
    where id = new.training_id;

    if referenced_organization_id is null
       or referenced_organization_id <> new.organization_id then
      raise exception 'O treinamento da regra deve pertencer à mesma organização.';
    end if;

    if new.active and not referenced_active then
      raise exception 'Somente treinamentos ativos podem ser vinculados à Matriz.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists control_matrix_rules_integrity
  on public.control_matrix_rules;

create trigger control_matrix_rules_integrity
before insert or update on public.control_matrix_rules
for each row
execute function public.enforce_control_matrix_rule_integrity();

create or replace function public.set_control_matrix_rules_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists control_matrix_rules_set_updated_at
  on public.control_matrix_rules;

create trigger control_matrix_rules_set_updated_at
before update on public.control_matrix_rules
for each row
execute function public.set_control_matrix_rules_updated_at();

revoke all privileges on table public.control_matrix_rules
from authenticated, anon, public;

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

commit;
