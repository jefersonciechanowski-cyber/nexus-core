alter table public.organizations
  drop constraint organizations_registration_number_check,
  add constraint organizations_registration_number_check
    check (
      (registration_type is null and registration_number is null)
      or (registration_type = 'CNPJ' and registration_number ~ '^[A-Z0-9]{12}[0-9]{2}$')
      or (registration_type = 'CPF' and registration_number ~ '^[0-9]{11}$')
    );
