-- Security-definer functions bypass RLS; explicitly check paid SST entitlement
-- before performing bulk imports, document audit or new managed tenancy.
-- This retains existing function signatures, business logic and EXECUTE grants.
begin;
do $$
declare
  v_name text;
  v_oid oid;
  v_definition text;
  v_replacement text;
  v_anchor text := E'\nbegin\n';
  v_guard text := E'\nbegin\n  if not private.sst_operational_access_allowed(public.current_org_id()) then\n    raise exception ''Acesso SST expirado ou sem autorização comercial. Regularize o contrato na Minha Central.'' using errcode = ''42501'';\n  end if;\n';
begin
  foreach v_name in array array[
    'import_employees_bulk',
    'import_epis_bulk',
    'import_exam_records_bulk',
    'log_sst_document_generation',
    'create_managed_organization_core'
  ] loop
    select p.oid into v_oid
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=v_name;
    if v_oid is null then raise exception 'Função SST não encontrada: %',v_name; end if;
    select pg_get_functiondef(v_oid) into v_definition;
    if v_definition not like '%SECURITY DEFINER%' then
      raise exception 'Função SST deixou de ser SECURITY DEFINER: %',v_name;
    end if;
    if v_definition like '%private.sst_operational_access_allowed(public.current_org_id())%' then
      continue; -- migration is safe to rerun
    end if;
    if position(v_anchor in v_definition)=0 then
      raise exception 'Cabeçalho inesperado da função: %',v_name;
    end if;
    v_replacement := overlay(
      v_definition placing v_guard
      from position(v_anchor in v_definition) for length(v_anchor)
    );
    execute v_replacement;
  end loop;
end $$;
commit;
