create table public.control_matrix_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid references public.units(id) on delete restrict,
  sector_id uuid references public.sectors(id) on delete restrict,
  job_role_id uuid references public.job_roles(id) on delete restrict,
  requirement_type text not null,
  exam_id uuid references public.exam_catalog(id) on delete restrict,
  training_id uuid references public.training_catalog(id) on delete restrict,
  epi_id uuid references public.epi_catalog(id) on delete restrict,
  requirement_name text not null,
  validity_days integer not null default 0,
  effective_from date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint control_matrix_rules_type_check
    check (requirement_type in ('EXAM', 'TRAINING', 'EPI', 'DOCUMENT', 'RISK')),
  constraint control_matrix_rules_name_check
    check (nullif(btrim(requirement_name), '') is not null),
  constraint control_matrix_rules_validity_check
    check (validity_days >= 0),
  constraint control_matrix_rules_registered_item_check
    check (
      (requirement_type = 'EXAM' and exam_id is not null and training_id is null and epi_id is null)
      or
      (requirement_type = 'TRAINING' and exam_id is null and training_id is not null and epi_id is null)
      or
      (requirement_type = 'EPI' and exam_id is null and training_id is null and epi_id is not null)
      or
      (requirement_type in ('DOCUMENT', 'RISK') and exam_id is null and training_id is null and epi_id is null)
    ),
  constraint control_matrix_rules_epi_context_check
    check (
      requirement_type <> 'EPI'
      or (
        unit_id is not null
        and sector_id is not null
        and job_role_id is not null
        and validity_days > 0
      )
    )
);

create index control_matrix_rules_org_active_idx
  on public.control_matrix_rules (
    organization_id,
    requirement_type,
    unit_id,
    sector_id,
    job_role_id
  )
  where active = true;

create unique index control_matrix_rules_active_context_unique
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

create policy "control matrix tenant select"
  on public.control_matrix_rules for select
  using (organization_id = public.current_org_id() or public.is_nexus_admin());

create policy "control matrix tenant insert"
  on public.control_matrix_rules for insert
  with check (organization_id = public.current_org_id() or public.is_nexus_admin());

create policy "control matrix tenant update"
  on public.control_matrix_rules for update
  using (organization_id = public.current_org_id() or public.is_nexus_admin())
  with check (organization_id = public.current_org_id() or public.is_nexus_admin());

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

    if not referenced_active then
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

    if not referenced_active then
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

    if not referenced_active then
      raise exception 'Somente treinamentos ativos podem ser vinculados à Matriz.';
    end if;
  end if;

  return new;
end;
$$;

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
