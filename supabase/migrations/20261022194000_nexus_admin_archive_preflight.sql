-- Leitura mínima de segurança para arquivamento administrativo Nexus.
-- Nunca expõe registros individuais; apenas informa a existência de dados reais.
create or replace function public.nexus_admin_archive_has_protected_data(p_org_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_org_id is null then
    return true;
  end if;

  return (
      exists(select 1 from public.profiles where organization_id = p_org_id)
      or       exists(select 1 from public.organization_memberships where organization_id = p_org_id)
      or       exists(select 1 from public.nexus_payments where organization_id = p_org_id)
      or       exists(select 1 from public.nexus_payment_checkouts where organization_id = p_org_id)
      or       exists(select 1 from public.nexus_sales where organization_id = p_org_id)
      or       exists(select 1 from public.support_requests where organization_id = p_org_id)
      or       exists(select 1 from public.nexus_ai_usage_events where organization_id = p_org_id)
      or       exists(select 1 from public.notification_delivery_logs where organization_id = p_org_id)
      or       exists(select 1 from public.employees where organization_id = p_org_id)
      or       exists(select 1 from public.units where organization_id = p_org_id)
      or       exists(select 1 from public.company_documents where organization_id = p_org_id)
      or       exists(select 1 from public.control_matrix_rules where organization_id = p_org_id)
      or       exists(select 1 from public.epi_catalog where organization_id = p_org_id)
      or       exists(select 1 from public.epi_deliveries where organization_id = p_org_id)
      or       exists(select 1 from public.epi_purchases where organization_id = p_org_id)
      or       exists(select 1 from public.exam_catalog where organization_id = p_org_id)
      or       exists(select 1 from public.exam_records where organization_id = p_org_id)
      or       exists(select 1 from public.job_roles where organization_id = p_org_id)
      or       exists(select 1 from public.occurrences where organization_id = p_org_id)
      or       exists(select 1 from public.occurrence_types where organization_id = p_org_id)
      or       exists(select 1 from public.regulatory_inspections where organization_id = p_org_id)
      or       exists(select 1 from public.regulatory_requirements where organization_id = p_org_id)
      or       exists(select 1 from public.sector_exam_requirements where organization_id = p_org_id)
      or       exists(select 1 from public.sectors where organization_id = p_org_id)
      or       exists(select 1 from public.training_catalog where organization_id = p_org_id)
      or       exists(select 1 from public.training_records where organization_id = p_org_id)
  );
end;
$$;

-- Uma SECURITY DEFINER em public não pode conservar o EXECUTE implícito de PUBLIC.
revoke all on function public.nexus_admin_archive_has_protected_data(uuid) from public, anon, authenticated;
grant execute on function public.nexus_admin_archive_has_protected_data(uuid) to service_role;
comment on function public.nexus_admin_archive_has_protected_data(uuid) is
  'Uso exclusivo do backend Nexus Admin após validar usuário, função administrativa e MFA; retorna só booleano de proteção.';
