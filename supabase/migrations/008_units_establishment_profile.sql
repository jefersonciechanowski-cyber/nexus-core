alter table public.units
  add column establishment_kind text not null default 'UNIDADE',
  add column registration_type text,
  add column registration_number text,
  add column cnae_preponderant text,
  add column esocial_valid_from date,
  add column esocial_valid_to date,
  add column cnpj_responsible text,
  add column caepf_type integer,
  add column construction_contribution_substitution integer,
  add column postal_code text,
  add column street text,
  add column street_number text,
  add column address_complement text,
  add column district text,
  add column city text,
  add column state text,
  add column updated_at timestamptz not null default now(),
  add constraint units_establishment_kind_check
    check (establishment_kind in ('MATRIZ', 'FILIAL', 'OBRA', 'UNIDADE')),
  add constraint units_registration_type_check
    check (registration_type is null or registration_type in ('CNPJ', 'CAEPF', 'CNO')),
  add constraint units_registration_number_check
    check (
      (registration_type is null and registration_number is null)
      or (registration_type = 'CNPJ' and registration_number ~ '^[A-Z0-9]{12}[0-9]{2}$')
      or (registration_type = 'CAEPF' and registration_number ~ '^[0-9]{14}$')
      or (registration_type = 'CNO' and registration_number ~ '^[0-9]{12}$')
    ),
  add constraint units_cnae_preponderant_check
    check (cnae_preponderant is null or cnae_preponderant ~ '^[0-9]{7}$'),
  add constraint units_esocial_valid_from_month_check
    check (esocial_valid_from is null or extract(day from esocial_valid_from) = 1),
  add constraint units_esocial_valid_to_month_check
    check (esocial_valid_to is null or extract(day from esocial_valid_to) = 1),
  add constraint units_esocial_valid_range_check
    check (esocial_valid_to is null or esocial_valid_from is null or esocial_valid_to >= esocial_valid_from),
  add constraint units_cnpj_responsible_check
    check (cnpj_responsible is null or (registration_type = 'CNO' and cnpj_responsible ~ '^[A-Z0-9]{12}[0-9]{2}$')),
  add constraint units_caepf_type_check
    check (caepf_type is null or (registration_type = 'CAEPF' and caepf_type in (1, 2, 3))),
  add constraint units_construction_contribution_substitution_check
    check (construction_contribution_substitution is null or (registration_type = 'CNO' and construction_contribution_substitution in (1, 2))),
  add constraint units_postal_code_check
    check (postal_code is null or postal_code ~ '^[0-9]{8}$'),
  add constraint units_state_check
    check (state is null or state in (
      'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
      'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
      'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
    ));

create unique index units_organization_registration_unique
  on public.units (organization_id, registration_type, registration_number)
  where registration_type is not null and registration_number is not null;

create or replace function public.set_units_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger units_set_updated_at
before update on public.units
for each row
execute function public.set_units_updated_at();
