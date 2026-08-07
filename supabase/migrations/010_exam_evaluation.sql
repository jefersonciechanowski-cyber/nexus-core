alter table public.exam_catalog
  add column result_type text not null default 'NUMERIC',
  add column esocial_reportable boolean not null default false,
  add column esocial_procedure_code text,
  add column updated_at timestamptz not null default now(),
  add constraint exam_catalog_result_type_check check (result_type in ('NUMERIC', 'QUALITATIVE')),
  add constraint exam_catalog_esocial_procedure_code_check check ((not esocial_reportable and esocial_procedure_code is null) or (esocial_reportable and esocial_procedure_code ~ '^[0-9]{4}$'));

create table public.exam_evaluation_rules (
  exam_id uuid primary key references public.exam_catalog(id) on delete cascade,
  evaluation_mode text not null default 'NONE', good_min numeric, good_max numeric, attention_min numeric, attention_max numeric,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint exam_evaluation_rules_mode_check check (evaluation_mode in ('NONE','LOWER_IS_BETTER','HIGHER_IS_BETTER','TARGET_RANGE')),
  constraint exam_evaluation_rules_values_check check (
    (evaluation_mode='NONE' and good_min is null and good_max is null and attention_min is null and attention_max is null)
    or (evaluation_mode='LOWER_IS_BETTER' and good_min is null and attention_min is null and good_max is not null and attention_max is not null and good_max < attention_max)
    or (evaluation_mode='HIGHER_IS_BETTER' and good_max is null and attention_max is null and attention_min is not null and good_min is not null and attention_min < good_min)
    or (evaluation_mode='TARGET_RANGE' and attention_min is not null and good_min is not null and good_max is not null and attention_max is not null and attention_min <= good_min and good_min <= good_max and good_max <= attention_max)
  )
);
alter table public.exam_evaluation_rules enable row level security;
create policy "exam evaluation rules select" on public.exam_evaluation_rules for select using (exists (select 1 from public.exam_catalog e where e.id=exam_id and (e.organization_id=public.current_org_id() or public.is_nexus_admin())));
create policy "exam evaluation rules insert" on public.exam_evaluation_rules for insert with check (exists (select 1 from public.exam_catalog e where e.id=exam_id and (e.organization_id=public.current_org_id() or public.is_nexus_admin())));
create policy "exam evaluation rules update" on public.exam_evaluation_rules for update using (exists (select 1 from public.exam_catalog e where e.id=exam_id and (e.organization_id=public.current_org_id() or public.is_nexus_admin()))) with check (exists (select 1 from public.exam_catalog e where e.id=exam_id and (e.organization_id=public.current_org_id() or public.is_nexus_admin())));
create policy "exam evaluation rules delete" on public.exam_evaluation_rules for delete using (exists (select 1 from public.exam_catalog e where e.id=exam_id and (e.organization_id=public.current_org_id() or public.is_nexus_admin())));
grant select, insert, update, delete on public.exam_evaluation_rules to authenticated;
create or replace function public.set_exam_catalog_updated_at() returns trigger language plpgsql set search_path=public as $$ begin new.updated_at=now(); return new; end; $$;
create trigger exam_catalog_set_updated_at before update on public.exam_catalog for each row execute function public.set_exam_catalog_updated_at();
create or replace function public.set_exam_evaluation_rules_updated_at() returns trigger language plpgsql set search_path=public as $$ begin new.updated_at=now(); return new; end; $$;
create trigger exam_evaluation_rules_set_updated_at before update on public.exam_evaluation_rules for each row execute function public.set_exam_evaluation_rules_updated_at();

create or replace function public.enforce_qualitative_exam_evaluation_rule()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  exam_result_type text;
begin
  select result_type into exam_result_type from public.exam_catalog where id = new.exam_id;
  if exam_result_type = 'QUALITATIVE' and new.evaluation_mode <> 'NONE' then
    raise exception 'Exames qualitativos aceitam apenas avaliação NONE.';
  end if;
  return new;
end;
$$;

create trigger exam_evaluation_rules_qualitative_guard
before insert or update on public.exam_evaluation_rules
for each row execute function public.enforce_qualitative_exam_evaluation_rule();

create or replace function public.clear_qualitative_exam_evaluation_rule()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.result_type = 'QUALITATIVE' and old.result_type is distinct from 'QUALITATIVE' then
    update public.exam_evaluation_rules
      set evaluation_mode = 'NONE', good_min = null, good_max = null, attention_min = null, attention_max = null
      where exam_id = new.id;
  end if;
  return new;
end;
$$;

create trigger exam_catalog_clear_qualitative_evaluation_rule
after update of result_type on public.exam_catalog
for each row execute function public.clear_qualitative_exam_evaluation_rule();
