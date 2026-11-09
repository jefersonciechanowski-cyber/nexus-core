begin;

-- Documentos do colaborador podem usar arquivo privado, link externo ou ambos.
-- Documentos já cadastrados permanecem inalterados.
alter table public.employee_documents
  add column external_url text,
  alter column attachment_path drop not null;

alter table public.employee_documents
  add constraint employee_documents_source_required check (
    nullif(btrim(attachment_path), '') is not null
    or nullif(btrim(external_url), '') is not null
  ),
  add constraint employee_documents_external_url_safe check (
    external_url is null or (
      char_length(external_url) <= 2048
      and external_url ~* '^https://(drive[.]google[.]com|docs[.]google[.]com|onedrive[.]live[.]com|1drv[.]ms|([a-z0-9-]+[.])+sharepoint[.]com)(/|[?#]|$)'
      and external_url !~ '[[:space:][:cntrl:]]'
    )
  );

-- Preserva a imutabilidade das fontes para manter a auditoria histórica;
-- o usuário pode anexar uma nova versão criando outro registro.
create or replace function public.enforce_employee_document_integrity()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id or
    new.organization_id is distinct from old.organization_id or
    new.employee_id is distinct from old.employee_id or
    new.created_by is distinct from old.created_by or
    new.created_at is distinct from old.created_at or
    new.attachment_path is distinct from old.attachment_path or
    new.external_url is distinct from old.external_url
  ) then
    raise exception 'A identidade e a origem do documento não podem ser modificadas. Cadastre uma nova versão.';
  end if;

  new.title = btrim(new.title);
  new.notes = nullif(btrim(new.notes), '');
  new.external_url = nullif(btrim(new.external_url), '');
  if new.attachment_path is not null
    and new.attachment_path not like
      new.organization_id::text || '/employees/' ||
      new.employee_id::text || '/' || new.id::text || '/%'
  then
    raise exception 'O anexo deve permanecer na pasta privada do colaborador.';
  end if;
  new.updated_at = now();
  return new;
end;
$$;

-- Mantém todos os GRANTs anteriores e permite o novo campo somente na criação.
grant insert (external_url) on public.employee_documents to authenticated;

commit;
