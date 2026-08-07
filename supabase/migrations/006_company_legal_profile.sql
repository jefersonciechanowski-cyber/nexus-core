alter table public.organizations
  add column legal_name text,
  add column trade_name text,
  add column registration_type text,
  add column registration_number text,
  add column state_registration text,
  add column cnae_code text,
  add column email text,
  add column phone text,
  add column postal_code text,
  add column street text,
  add column street_number text,
  add column address_complement text,
  add column district text,
  add column city text,
  add column state text,
  add column legal_responsible_name text,
  add column legal_responsible_cpf text,
  add column legal_responsible_role text,
  add column updated_at timestamptz not null default now(),
  add constraint organizations_registration_type_check
    check (registration_type is null or registration_type in ('CNPJ', 'CPF')),
  add constraint organizations_registration_number_check
    check (
      (registration_type is null and registration_number is null)
      or (registration_type = 'CNPJ' and registration_number ~ '^[0-9]{14}$')
      or (registration_type = 'CPF' and registration_number ~ '^[0-9]{11}$')
    ),
  add constraint organizations_state_check
    check (state is null or state in (
      'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
      'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
      'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
    )),
  add constraint organizations_legal_responsible_cpf_check
    check (legal_responsible_cpf is null or legal_responsible_cpf ~ '^[0-9]{11}$');

comment on column public.organizations.cnae_code is
  'CNAE do empregador para cadastro legal e documentos. Futuramente, cada unidade/estabelecimento poderá possuir CNAE próprio ou preponderante para integração eSocial S-1005.';

create or replace function public.set_organizations_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_set_updated_at
before update on public.organizations
for each row
execute function public.set_organizations_updated_at();

create policy "update own organization"
  on public.organizations for update
  using (id = public.current_org_id() or public.is_nexus_admin())
  with check (id = public.current_org_id() or public.is_nexus_admin());

grant update (
  legal_name,
  trade_name,
  registration_type,
  registration_number,
  state_registration,
  cnae_code,
  email,
  phone,
  postal_code,
  street,
  street_number,
  address_complement,
  district,
  city,
  state,
  legal_responsible_name,
  legal_responsible_cpf,
  legal_responsible_role
) on public.organizations to authenticated;
