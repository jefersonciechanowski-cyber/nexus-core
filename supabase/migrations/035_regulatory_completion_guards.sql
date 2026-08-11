begin;

create or replace function public.enforce_regulatory_inspection_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  linked_org uuid;
begin
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Os dados de origem da fiscalização não podem ser alterados.';
  end if;

  if new.unit_id is not null then
    select organization_id into linked_org
    from public.units
    where id = new.unit_id;

    if linked_org is null or linked_org <> new.organization_id then
      raise exception 'A unidade da fiscalização deve pertencer à mesma organização.';
    end if;
  end if;

  new.authority_name = btrim(new.authority_name);
  new.notice_number = nullif(btrim(new.notice_number), '');
  new.subject = btrim(new.subject);
  new.description = nullif(btrim(new.description), '');
  new.responsible_name = nullif(btrim(new.responsible_name), '');
  new.priority = upper(btrim(new.priority));
  new.status = upper(btrim(new.status));

  if new.status = 'COMPLETED' then
    if exists (
      select 1
      from public.regulatory_requirements requirement
      where requirement.inspection_id = new.id
        and requirement.organization_id = new.organization_id
        and requirement.status <> 'COMPLETED'
    ) then
      raise exception 'Conclua todas as exigências pendentes antes de concluir a fiscalização.';
    end if;
    new.completed_at = coalesce(new.completed_at, now());
  else
    new.completed_at = null;
  end if;

  if new.notice_path is not null
     and new.notice_path not like new.organization_id::text || '/compliance/inspections/%' then
    raise exception 'O anexo da fiscalização deve permanecer na pasta privada da organização.';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.enforce_regulatory_requirement_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  linked_org uuid;
  inspection_date_value date;
begin
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.inspection_id is distinct from old.inspection_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Os dados de origem da exigência não podem ser alterados.';
  end if;

  select organization_id, inspection_date
    into linked_org, inspection_date_value
  from public.regulatory_inspections
  where id = new.inspection_id;

  if linked_org is null or linked_org <> new.organization_id then
    raise exception 'A exigência deve pertencer a uma fiscalização da mesma organização.';
  end if;

  if new.due_at < inspection_date_value then
    raise exception 'O prazo da exigência não pode ser anterior à fiscalização.';
  end if;

  new.description = btrim(new.description);
  new.responsible_name = nullif(btrim(new.responsible_name), '');
  new.completion_notes = nullif(btrim(new.completion_notes), '');
  new.priority = upper(btrim(new.priority));
  new.status = upper(btrim(new.status));

  if new.status = 'COMPLETED' then
    if new.completion_notes is null then
      raise exception 'Informe o atendimento realizado antes de concluir a exigência.';
    end if;
    new.completed_at = coalesce(new.completed_at, now());
  else
    new.completed_at = null;
  end if;

  if new.evidence_path is not null
     and new.evidence_path not like new.organization_id::text || '/compliance/requirements/%' then
    raise exception 'A evidência deve permanecer na pasta privada da organização.';
  end if;

  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.enforce_regulatory_inspection_integrity(), public.enforce_regulatory_requirement_integrity()
from public, anon, authenticated;

commit;
