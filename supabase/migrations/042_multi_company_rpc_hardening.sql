begin;

-- Funções usadas exclusivamente por triggers não devem ficar expostas no REST/RPC.
revoke all on function public.enforce_nexus_account_organization_limit() from public, anon, authenticated;
revoke all on function public.ensure_nexus_account_for_profile() from public, anon, authenticated;
revoke all on function public.sync_multi_company_product_access() from public, anon, authenticated;

-- O guard de colaboradores também é apenas trigger interno.
revoke all on function public.enforce_sst_employee_plan_limit() from public, anon, authenticated;

comment on function public.enforce_nexus_account_organization_limit() is 'Trigger interno; sem execução direta por clientes.';
comment on function public.ensure_nexus_account_for_profile() is 'Trigger interno de compatibilidade de onboarding; sem execução direta por clientes.';
comment on function public.sync_multi_company_product_access() is 'Trigger interno de sincronização de direitos; sem execução direta por clientes.';

commit;
