begin;

create table public.company_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid references public.units(id) on delete restrict,
  document_type text not null,
  authority_name text,
  document_number text,
  issued_at date,
  expires_at date,
  responsible_name text,
  status text not null default 'ACTIVE',
  notes text,
  attachment_path text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint company_documents_type_check check (nullif(btrim(document_type), '') is not null),
  constraint company_documents_status_check check (status in ('ACTIVE','REPLACED','ARCHIVED')),
  constraint company_documents_dates_check check (expires_at is null or issued_at is null or expires_at >= issued_at),
  constraint company_documents_attachment_path_check check (
    attachment_path is null
    or attachment_path like organization_id::text || '/compliance/documents/%'
  )
);

create table public.regulatory_inspections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  unit_id uuid references public.units(id) on delete restrict,
  authority_name text not null,
  inspection_date date not null,
  notice_number text,
  subject text not null,
  description text,
  priority text not null default 'MEDIUM',
  status text not null default 'OPEN',
  responsible_name text,
  notice_path text,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint regulatory_inspections_authority_check check (nullif(btrim(authority_name), '') is not null),
  constraint regulatory_inspections_subject_check check (nullif(btrim(subject), '') is not null),
  constraint regulatory_inspections_priority_check check (priority in ('LOW','MEDIUM','HIGH','CRITICAL')),
  constraint regulatory_inspections_status_check check (status in ('OPEN','IN_PROGRESS','COMPLETED')),
  constraint regulatory_inspections_completed_check check (
    (status = 'COMPLETED' and completed_at is not null)
    or (status <> 'COMPLETED' and completed_at is null)
  ),
  constraint regulatory_inspections_notice_path_check check (
    notice_path is null
    or notice_path like organization_id::text || '/compliance/inspections/%'
  )
);

create table public.regulatory_requirements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  inspection_id uuid not null references public.regulatory_inspections(id) on delete restrict,
  description text not null,
  due_at date not null,
  responsible_name text,
  priority text not null default 'MEDIUM',
  status text not null default 'PENDING',
  completion_notes text,
  evidence_path text,
  completed_at timestamptz,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint regulatory_requirements_description_check check (nullif(btrim(description), '') is not null),
  constraint regulatory_requirements_priority_check check (priority in ('LOW','MEDIUM','HIGH','CRITICAL')),
  constraint regulatory_requirements_status_check check (status in ('PENDING','IN_PROGRESS','COMPLETED')),
  constraint regulatory_requirements_completed_check check (
    (status = 'COMPLETED' and completed_at is not null)
    or (status <> 'COMPLETED' and completed_at is null)
  ),
  constraint regulatory_requirements_evidence_path_check check (
    evidence_path is null
    or evidence_path like organization_id::text || '/compliance/requirements/%'
  )
);

create index company_documents_org_status_expiry_idx
  on public.company_documents (organization_id, status, expires_at);
create index company_documents_org_unit_idx
  on public.company_documents (organization_id, unit_id, document_type);
create index regulatory_inspections_org_status_date_idx
  on public.regulatory_inspections (organization_id, status, inspection_date desc);
create index regulatory_requirements_org_status_due_idx
  on public.regulatory_requirements (organization_id, status, due_at);
create index regulatory_requirements_inspection_idx
  on public.regulatory_requirements (inspection_id, status, due_at);

alter table public.company_documents enable row level security;
alter table public.regulatory_inspections enable row level security;
alter table public.regulatory_requirements enable row level security;

create policy "company documents tenant select"
  on public.company_documents for select to authenticated
  using (organization_id = public.current_org_id() or public.is_nexus_admin());
create policy "company documents tenant insert"
  on public.company_documents for insert to authenticated
  with check (organization_id = public.current_org_id() or public.is_nexus_admin());
create policy "company documents tenant update"
  on public.company_documents for update to authenticated
  using (organization_id = public.current_org_id() or public.is_nexus_admin())
  with check (organization_id = public.current_org_id() or public.is_nexus_admin());

create policy "regulatory inspections tenant select"
  on public.regulatory_inspections for select to authenticated
  using (organization_id = public.current_org_id() or public.is_nexus_admin());
create policy "regulatory inspections tenant insert"
  on public.regulatory_inspections for insert to authenticated
  with check (organization_id = public.current_org_id() or public.is_nexus_admin());
create policy "regulatory inspections tenant update"
  on public.regulatory_inspections for update to authenticated
  using (organization_id = public.current_org_id() or public.is_nexus_admin())
  with check (organization_id = public.current_org_id() or public.is_nexus_admin());

create policy "regulatory requirements tenant select"
  on public.regulatory_requirements for select to authenticated
  using (organization_id = public.current_org_id() or public.is_nexus_admin());
create policy "regulatory requirements tenant insert"
  on public.regulatory_requirements for insert to authenticated
  with check (organization_id = public.current_org_id() or public.is_nexus_admin());
create policy "regulatory requirements tenant update"
  on public.regulatory_requirements for update to authenticated
  using (organization_id = public.current_org_id() or public.is_nexus_admin())
  with check (organization_id = public.current_org_id() or public.is_nexus_admin());

revoke all privileges on table public.company_documents, public.regulatory_inspections, public.regulatory_requirements
from anon, authenticated, public;

grant select on table public.company_documents, public.regulatory_inspections, public.regulatory_requirements
to authenticated;

grant insert (
  id, organization_id, unit_id, document_type, authority_name, document_number,
  issued_at, expires_at, responsible_name, status, notes, attachment_path
) on public.company_documents to authenticated;
grant update (
  unit_id, document_type, authority_name, document_number, issued_at, expires_at,
  responsible_name, status, notes, attachment_path, updated_at
) on public.company_documents to authenticated;

grant insert (
  id, organization_id, unit_id, authority_name, inspection_date, notice_number,
  subject, description, priority, status, responsible_name, notice_path
) on public.regulatory_inspections to authenticated;
grant update (
  unit_id, authority_name, inspection_date, notice_number, subject, description,
  priority, status, responsible_name, notice_path, completed_at, updated_at
) on public.regulatory_inspections to authenticated;

grant insert (
  id, organization_id, inspection_id, description, due_at, responsible_name,
  priority, status, completion_notes, evidence_path
) on public.regulatory_requirements to authenticated;
grant update (
  description, due_at, responsible_name, priority, status, completion_notes,
  evidence_path, completed_at, updated_at
) on public.regulatory_requirements to authenticated;

create or replace function public.enforce_company_compliance_integrity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  linked_org uuid;
  inspection_date_value date;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.organization_id is distinct from old.organization_id
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'Os dados de origem do registro não podem ser alterados.';
    end if;
  end if;

  if new.unit_id is not null then
    select organization_id into linked_org from public.units where id = new.unit_id;
    if linked_org is null or linked_org <> new.organization_id then
      raise exception 'A unidade deve pertencer à mesma organização.';
    end if;
  end if;

  if tg_table_name = 'company_documents' then
    new.document_type = btrim(new.document_type);
    new.authority_name = nullif(btrim(new.authority_name), '');
    new.document_number = nullif(btrim(new.document_number), '');
    new.responsible_name = nullif(btrim(new.responsible_name), '');
    new.notes = nullif(btrim(new.notes), '');
    new.status = upper(btrim(new.status));
    if new.attachment_path is not null and new.attachment_path not like new.organization_id::text || '/compliance/documents/%' then
      raise exception 'O anexo do documento deve permanecer na pasta privada da organização.';
    end if;
  elsif tg_table_name = 'regulatory_inspections' then
    new.authority_name = btrim(new.authority_name);
    new.notice_number = nullif(btrim(new.notice_number), '');
    new.subject = btrim(new.subject);
    new.description = nullif(btrim(new.description), '');
    new.responsible_name = nullif(btrim(new.responsible_name), '');
    new.priority = upper(btrim(new.priority));
    new.status = upper(btrim(new.status));
    if new.status = 'COMPLETED' then
      new.completed_at = coalesce(new.completed_at, now());
    else
      new.completed_at = null;
    end if;
    if new.notice_path is not null and new.notice_path not like new.organization_id::text || '/compliance/inspections/%' then
      raise exception 'O anexo da fiscalização deve permanecer na pasta privada da organização.';
    end if;
  elsif tg_table_name = 'regulatory_requirements' then
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
      new.completed_at = coalesce(new.completed_at, now());
    else
      new.completed_at = null;
    end if;
    if new.evidence_path is not null and new.evidence_path not like new.organization_id::text || '/compliance/requirements/%' then
      raise exception 'A evidência deve permanecer na pasta privada da organização.';
    end if;
  end if;

  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.enforce_company_compliance_integrity()
from public, anon, authenticated;

create trigger company_documents_integrity
before insert or update on public.company_documents
for each row execute function public.enforce_company_compliance_integrity();
create trigger regulatory_inspections_integrity
before insert or update on public.regulatory_inspections
for each row execute function public.enforce_company_compliance_integrity();
create trigger regulatory_requirements_integrity
before insert or update on public.regulatory_requirements
for each row execute function public.enforce_company_compliance_integrity();

create or replace function public.audit_company_compliance_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.audit_logs (organization_id, user_id, action, entity, entity_id, metadata)
  values (
    new.organization_id,
    auth.uid(),
    case
      when tg_table_name = 'company_documents' and tg_op = 'INSERT' then 'COMPANY_DOCUMENT_CREATED'
      when tg_table_name = 'company_documents' then 'COMPANY_DOCUMENT_UPDATED'
      when tg_table_name = 'regulatory_inspections' and tg_op = 'INSERT' then 'REGULATORY_INSPECTION_CREATED'
      when tg_table_name = 'regulatory_inspections' then 'REGULATORY_INSPECTION_UPDATED'
      when tg_table_name = 'regulatory_requirements' and tg_op = 'INSERT' then 'REGULATORY_REQUIREMENT_CREATED'
      else 'REGULATORY_REQUIREMENT_UPDATED'
    end,
    tg_table_name,
    new.id::text,
    case
      when tg_table_name = 'company_documents' then jsonb_build_object('document_type', new.document_type, 'status', new.status, 'expires_at', new.expires_at)
      when tg_table_name = 'regulatory_inspections' then jsonb_build_object('authority_name', new.authority_name, 'subject', new.subject, 'status', new.status)
      else jsonb_build_object('inspection_id', new.inspection_id, 'status', new.status, 'due_at', new.due_at)
    end
  );
  return new;
end;
$$;

revoke execute on function public.audit_company_compliance_change()
from public, anon, authenticated;

create trigger company_documents_audit
after insert or update on public.company_documents
for each row execute function public.audit_company_compliance_change();
create trigger regulatory_inspections_audit
after insert or update on public.regulatory_inspections
for each row execute function public.audit_company_compliance_change();
create trigger regulatory_requirements_audit
after insert or update on public.regulatory_requirements
for each row execute function public.audit_company_compliance_change();

update storage.buckets
set
  file_size_limit = 10485760,
  allowed_mime_types = array[
    'image/png',
    'image/jpeg',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
where id = 'sst-documents';

commit;
