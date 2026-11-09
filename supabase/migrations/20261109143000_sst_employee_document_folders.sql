begin;

-- Os vínculos de funcionário e organização precisam ser consistentes mesmo com RLS.
create unique index if not exists employees_id_organization_id_key
  on public.employees (id, organization_id);

create table public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null,
  document_type text not null check (document_type in ('ASO','CERTIFICADO','FICHA_EPI','OUTRO')),
  title text not null check (char_length(btrim(title)) between 1 and 180),
  issued_at date,
  expires_at date,
  notes text check (notes is null or char_length(notes) <= 1500),
  attachment_path text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'ARCHIVED')),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint employee_documents_employee_organization_fk
    foreign key (employee_id, organization_id)
    references public.employees (id, organization_id) on delete restrict,
  constraint employee_documents_dates_check
    check (issued_at is null or expires_at is null or expires_at >= issued_at)
);

create index employee_documents_employee_idx
  on public.employee_documents (organization_id, employee_id, created_at desc);
create index employee_documents_due_idx
  on public.employee_documents (organization_id, expires_at)
  where status = 'ACTIVE' and expires_at is not null;

comment on table public.employee_documents is
  'Documentos anexados ao colaborador, com histórico preservado e segregação por organização.';

alter table public.employee_documents enable row level security;

create policy "employee documents tenant select"
  on public.employee_documents for select to authenticated
  using (
    (organization_id = public.current_org_id() or public.is_nexus_admin_aal2())
    and (public.is_nexus_admin_aal2() or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.active
        and p.role in ('org_admin', 'sst_manager', 'sst_technician', 'hr')
    ))
  );

create policy "employee documents tenant insert"
  on public.employee_documents for insert to authenticated
  with check (
    (organization_id = public.current_org_id() or public.is_nexus_admin_aal2())
    and (public.is_nexus_admin_aal2() or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.active
        and p.role in ('org_admin', 'sst_manager', 'sst_technician')
    ))
  );

create policy "employee documents tenant update"
  on public.employee_documents for update to authenticated
  using (
    (organization_id = public.current_org_id() or public.is_nexus_admin_aal2())
    and (public.is_nexus_admin_aal2() or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.active
        and p.role in ('org_admin', 'sst_manager', 'sst_technician')
    ))
  )
  with check (
    (organization_id = public.current_org_id() or public.is_nexus_admin_aal2())
    and (public.is_nexus_admin_aal2() or exists (
      select 1 from public.profiles p
      where p.id = (select auth.uid()) and p.active
        and p.role in ('org_admin', 'sst_manager', 'sst_technician')
    ))
  );

create function public.enforce_employee_document_integrity()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id or
    new.organization_id is distinct from old.organization_id or
    new.employee_id is distinct from old.employee_id or
    new.created_by is distinct from old.created_by or
    new.created_at is distinct from old.created_at or
    new.attachment_path is distinct from old.attachment_path
  ) then
    raise exception 'A identidade e o arquivo do documento não podem ser modificados. Anexe uma nova versão.';
  end if;

  new.title = btrim(new.title);
  new.notes = nullif(btrim(new.notes), '');
  if new.attachment_path not like
    new.organization_id::text || '/employees/' ||
    new.employee_id::text || '/' || new.id::text || '/%'
  then
    raise exception 'O anexo deve permanecer na pasta privada do colaborador.';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

revoke execute on function public.enforce_employee_document_integrity()
  from public, anon, authenticated;

create trigger employee_documents_integrity
  before insert or update on public.employee_documents
  for each row execute function public.enforce_employee_document_integrity();

create function public.audit_employee_document_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.audit_logs (organization_id, user_id, action, entity, entity_id, metadata)
  values (
    new.organization_id, auth.uid(),
    case when tg_op = 'INSERT' then 'EMPLOYEE_DOCUMENT_CREATED'
         else 'EMPLOYEE_DOCUMENT_UPDATED' end,
    'employee_documents', new.id::text,
    jsonb_build_object(
      'employee_id', new.employee_id,
      'document_type', new.document_type,
      'status', new.status,
      'expires_at', new.expires_at
    )
  );
  return new;
end;
$$;

revoke execute on function public.audit_employee_document_change()
  from public, anon, authenticated;

create trigger employee_documents_audit
  after insert or update on public.employee_documents
  for each row execute function public.audit_employee_document_change();

-- Outros documentos da empresa mantêm as políticas originais.
-- Pastas de colaboradores exigem permissão SST/RH mesmo com caminho conhecido.
create policy "sst employee folders restricted select"
on storage.objects as restrictive for select to authenticated
using (
  bucket_id <> 'sst-documents'
  or coalesce((storage.foldername(name))[2], '') <> 'employees'
  or public.is_nexus_admin_aal2()
  or exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.active
      and p.role in ('org_admin', 'sst_manager', 'sst_technician', 'hr')
  )
);

revoke all on public.employee_documents from public, anon, authenticated;
grant select on public.employee_documents to authenticated;
grant insert (
  id, organization_id, employee_id, document_type, title, issued_at,
  expires_at, notes, attachment_path
) on public.employee_documents to authenticated;
grant update (status, updated_at) on public.employee_documents to authenticated;

commit;
