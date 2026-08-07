alter table public.employees
  add column cpf text,
  add column birth_date date,
  add column esocial_worker_type text,
  add column esocial_registration text,
  add column esocial_category_code text,
  add column relationship_start_date date,
  add column relationship_end_date date,
  add column updated_at timestamptz not null default now(),
  add constraint employees_cpf_check
    check (cpf is null or cpf ~ '^[0-9]{11}$'),
  add constraint employees_esocial_worker_type_check
    check (esocial_worker_type is null or esocial_worker_type in ('VINCULO', 'TSVE')),
  add constraint employees_esocial_registration_length_check
    check (esocial_registration is null or (
      esocial_registration = btrim(esocial_registration)
      and char_length(btrim(esocial_registration)) between 1 and 30
    )),
  add constraint employees_esocial_category_code_check
    check (esocial_category_code is null or esocial_category_code ~ '^[0-9]{3}$'),
  add constraint employees_relationship_dates_check
    check (relationship_end_date is null or relationship_start_date is null or relationship_end_date >= relationship_start_date);

create unique index employees_organization_esocial_registration_unique
  on public.employees (organization_id, esocial_registration)
  where esocial_registration is not null;

create or replace function public.set_employees_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger employees_set_updated_at
before update on public.employees
for each row
execute function public.set_employees_updated_at();
