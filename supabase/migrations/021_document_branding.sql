begin;

alter table public.organizations
  add column if not exists logo_path text;

alter table public.organizations
  drop constraint if exists organizations_logo_path_check;

alter table public.organizations
  add constraint organizations_logo_path_check
    check (
      logo_path is null
      or logo_path = id::text || '/branding/company-logo'
    );

grant update (logo_path)
on public.organizations
to authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'sst-documents',
  'sst-documents',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'sst documents tenant select'
  ) then
    create policy "sst documents tenant select"
      on storage.objects for select
      to authenticated
      using (
        bucket_id = 'sst-documents'
        and (
          (storage.foldername(name))[1] = public.current_org_id()::text
          or public.is_nexus_admin()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'sst documents tenant insert'
  ) then
    create policy "sst documents tenant insert"
      on storage.objects for insert
      to authenticated
      with check (
        bucket_id = 'sst-documents'
        and (
          (storage.foldername(name))[1] = public.current_org_id()::text
          or public.is_nexus_admin()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'sst documents tenant update'
  ) then
    create policy "sst documents tenant update"
      on storage.objects for update
      to authenticated
      using (
        bucket_id = 'sst-documents'
        and (
          (storage.foldername(name))[1] = public.current_org_id()::text
          or public.is_nexus_admin()
        )
      )
      with check (
        bucket_id = 'sst-documents'
        and (
          (storage.foldername(name))[1] = public.current_org_id()::text
          or public.is_nexus_admin()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'sst documents tenant delete'
  ) then
    create policy "sst documents tenant delete"
      on storage.objects for delete
      to authenticated
      using (
        bucket_id = 'sst-documents'
        and (
          (storage.foldername(name))[1] = public.current_org_id()::text
          or public.is_nexus_admin()
        )
      );
  end if;
end;
$$;

alter table public.training_records
  add column if not exists training_kind text,
  add column if not exists technical_responsible_name text,
  add column if not exists technical_responsible_qualification text,
  add column if not exists employee_name_snapshot text,
  add column if not exists company_name_snapshot text,
  add column if not exists company_registration_type_snapshot text,
  add column if not exists company_registration_number_snapshot text;

-- A migration roda pelo SQL Editor sem uma sessao auth.uid(). Remova apenas
-- o gatilho da aplicacao durante o backfill documental e recrie-o antes de
-- instalar as novas regras. A transacao restaura o gatilho e os dados se
-- qualquer instrucao intermediaria falhar.
drop trigger if exists training_records_integrity
  on public.training_records;

update public.training_records
set training_kind = 'UNSPECIFIED'
where training_kind is null;

update public.training_records record
set employee_name_snapshot = employee.full_name
from public.employees employee
where employee.id = record.employee_id
  and employee.organization_id = record.organization_id
  and record.employee_name_snapshot is null;

update public.training_records record
set
  company_name_snapshot = coalesce(
    nullif(btrim(organization.legal_name), ''),
    nullif(btrim(organization.trade_name), ''),
    organization.name
  ),
  company_registration_type_snapshot = organization.registration_type,
  company_registration_number_snapshot = organization.registration_number
from public.organizations organization
where organization.id = record.organization_id
  and record.company_name_snapshot is null;

create trigger training_records_integrity
before insert or update on public.training_records
for each row
execute function public.enforce_training_record_integrity();

alter table public.training_records
  alter column training_kind set default 'UNSPECIFIED',
  alter column training_kind set not null,
  alter column employee_name_snapshot set not null,
  alter column company_name_snapshot set not null;

alter table public.training_records
  drop constraint if exists training_records_kind_check;

alter table public.training_records
  drop constraint if exists training_records_document_lengths_check;

alter table public.training_records
  add constraint training_records_kind_check
    check (training_kind in ('INITIAL', 'PERIODIC', 'EVENTUAL', 'UNSPECIFIED'));

alter table public.training_records
  add constraint training_records_document_lengths_check
    check (
      char_length(coalesce(program_content, '')) <= 1200
      and char_length(coalesce(training_location, '')) <= 240
      and char_length(coalesce(instructor_document, '')) <= 240
      and char_length(coalesce(technical_responsible_name, '')) <= 180
      and char_length(coalesce(technical_responsible_qualification, '')) <= 240
    ) not valid;

comment on column public.organizations.logo_path is
  'Caminho privado da logo da empresa cliente usada em relatórios e certificados.';

comment on column public.training_records.training_kind is
  'Natureza do treinamento conforme a NR-1: inicial, periódico ou eventual. UNSPECIFIED identifica somente registros legados.';

comment on column public.training_records.technical_responsible_name is
  'Responsável técnico que deverá assinar o certificado do treinamento.';

comment on column public.training_records.employee_name_snapshot is
  'Nome do trabalhador preservado no momento do registro para estabilidade documental.';

create or replace function public.enforce_training_certificate_context()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  employee_row public.employees%rowtype;
  organization_row public.organizations%rowtype;
begin
  if tg_op = 'UPDATE' then
    if new.training_kind is distinct from old.training_kind
       or new.technical_responsible_name is distinct from old.technical_responsible_name
       or new.technical_responsible_qualification is distinct from old.technical_responsible_qualification
       or new.employee_name_snapshot is distinct from old.employee_name_snapshot
       or new.company_name_snapshot is distinct from old.company_name_snapshot
       or new.company_registration_type_snapshot is distinct from old.company_registration_type_snapshot
       or new.company_registration_number_snapshot is distinct from old.company_registration_number_snapshot then
      raise exception 'O contexto documental original do treinamento não pode ser alterado.';
    end if;
    return new;
  end if;

  new.training_kind = upper(nullif(btrim(new.training_kind), ''));
  new.instructor_document = nullif(btrim(new.instructor_document), '');
  new.training_location = nullif(btrim(new.training_location), '');
  new.program_content = nullif(btrim(new.program_content), '');
  new.technical_responsible_name = nullif(btrim(new.technical_responsible_name), '');
  new.technical_responsible_qualification = nullif(btrim(new.technical_responsible_qualification), '');

  if new.training_kind is null
     or new.training_kind not in ('INITIAL', 'PERIODIC', 'EVENTUAL') then
    raise exception 'Informe se o treinamento é inicial, periódico ou eventual.';
  end if;

  if new.instructor_document is null then
    raise exception 'Informe a qualificação ou registro do instrutor.';
  end if;

  if new.training_location is null then
    raise exception 'Informe o local de realização do treinamento.';
  end if;

  if new.program_content is null then
    raise exception 'Informe o conteúdo programático do treinamento.';
  end if;

  if new.technical_responsible_name is null
     or new.technical_responsible_qualification is null then
    raise exception 'Informe o nome e a qualificação do responsável técnico do treinamento.';
  end if;

  select * into employee_row
  from public.employees
  where id = new.employee_id
    and organization_id = new.organization_id;

  if employee_row.id is null then
    raise exception 'O colaborador deve pertencer à mesma organização do treinamento.';
  end if;

  select * into organization_row
  from public.organizations
  where id = new.organization_id;

  if organization_row.id is null then
    raise exception 'A organização do treinamento não foi encontrada.';
  end if;

  new.employee_name_snapshot = employee_row.full_name;
  new.company_name_snapshot = coalesce(
    nullif(btrim(organization_row.legal_name), ''),
    nullif(btrim(organization_row.trade_name), ''),
    organization_row.name
  );
  new.company_registration_type_snapshot = organization_row.registration_type;
  new.company_registration_number_snapshot = organization_row.registration_number;
  return new;
end;
$$;

drop trigger if exists training_records_certificate_context
  on public.training_records;

create trigger training_records_certificate_context
before insert or update on public.training_records
for each row
execute function public.enforce_training_certificate_context();

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
    jsonb_strip_nulls(jsonb_build_object(
      'record_code', new.record_code,
      'employee_id', new.employee_id,
      'employee_name', new.employee_name_snapshot,
      'training_type_id', new.training_type_id,
      'training_name', new.training_name,
      'training_kind', new.training_kind,
      'completed_at', new.completed_at,
      'expires_at', new.expires_at,
      'workload_hours', new.workload_hours,
      'instructor_name', new.instructor_name,
      'technical_responsible_name', new.technical_responsible_name,
      'status', new.status,
      'cancel_reason', new.cancel_reason
    ))
  );
  return new;
end;
$$;

create or replace function public.audit_company_logo_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.logo_path is distinct from old.logo_path then
    insert into public.audit_logs (
      organization_id,
      user_id,
      action,
      entity,
      entity_id,
      metadata
    ) values (
      new.id,
      auth.uid(),
      case when new.logo_path is null then 'COMPANY_LOGO_REMOVED' else 'COMPANY_LOGO_UPDATED' end,
      'organizations',
      new.id::text,
      jsonb_build_object('logo_path', new.logo_path)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists organizations_logo_audit
  on public.organizations;

create trigger organizations_logo_audit
after update of logo_path on public.organizations
for each row
execute function public.audit_company_logo_change();

create or replace function public.log_sst_document_generation(
  p_document_type text,
  p_document_code text,
  p_source_training_record_id uuid default null,
  p_scope jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  organization_id_value uuid;
  normalized_type text;
  normalized_code text;
begin
  if auth.uid() is null then
    raise exception 'É necessário estar autenticado para emitir documentos.';
  end if;

  organization_id_value = public.current_org_id();
  if organization_id_value is null then
    raise exception 'A organização autenticada não foi identificada.';
  end if;

  normalized_type = upper(nullif(btrim(p_document_type), ''));
  normalized_code = upper(nullif(btrim(p_document_code), ''));

  if normalized_type is null
     or normalized_type not in ('TRAINING_CERTIFICATE', 'INSPECTION_DOSSIER', 'CUSTOM_REPORT') then
    raise exception 'Tipo de documento inválido.';
  end if;

  if normalized_code is null
     or char_length(normalized_code) > 80
     or normalized_code !~ '^[A-Z0-9-]+$' then
    raise exception 'Código de documento inválido.';
  end if;

  if pg_column_size(coalesce(p_scope, '{}'::jsonb)) > 16384 then
    raise exception 'O escopo informado para a auditoria é maior que o permitido.';
  end if;

  if normalized_type = 'TRAINING_CERTIFICATE' then
    if p_source_training_record_id is null
       or not exists (
         select 1
         from public.training_records record
         where record.id = p_source_training_record_id
           and record.organization_id = organization_id_value
           and record.status = 'COMPLETED'
           and record.training_kind in ('INITIAL', 'PERIODIC', 'EVENTUAL')
           and nullif(btrim(record.program_content), '') is not null
           and nullif(btrim(record.training_location), '') is not null
           and nullif(btrim(record.instructor_document), '') is not null
           and nullif(btrim(record.technical_responsible_name), '') is not null
           and nullif(btrim(record.technical_responsible_qualification), '') is not null
       ) then
      raise exception 'O certificado deve estar vinculado a um treinamento válido da organização.';
    end if;
  elsif p_source_training_record_id is not null then
    raise exception 'Somente certificados podem informar um treinamento de origem.';
  end if;

  insert into public.audit_logs (
    organization_id,
    user_id,
    action,
    entity,
    entity_id,
    metadata
  ) values (
    organization_id_value,
    auth.uid(),
    'SST_DOCUMENT_GENERATED',
    'sst_documents',
    coalesce(p_source_training_record_id::text, normalized_code),
    jsonb_build_object(
      'document_type', normalized_type,
      'document_code', normalized_code,
      'source_training_record_id', p_source_training_record_id,
      'scope', coalesce(p_scope, '{}'::jsonb)
    )
  );
end;
$$;

revoke execute on function public.enforce_training_certificate_context()
from public, authenticated, anon;

revoke execute on function public.audit_training_record_change()
from public, authenticated, anon;

revoke execute on function public.audit_company_logo_change()
from public, authenticated, anon;

revoke execute on function public.log_sst_document_generation(text, text, uuid, jsonb)
from public, anon;

grant execute on function public.log_sst_document_generation(text, text, uuid, jsonb)
to authenticated;

grant insert (
  training_kind,
  technical_responsible_name,
  technical_responsible_qualification
) on public.training_records to authenticated;

commit;
