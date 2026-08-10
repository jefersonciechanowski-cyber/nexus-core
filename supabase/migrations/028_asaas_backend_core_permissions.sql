begin;

-- The Asaas Edge Functions run with SUPABASE_SERVICE_ROLE_KEY.
-- These explicit grants are required by PostgREST even though service_role bypasses RLS.
grant select, update on public.organization_product_access to service_role;
grant select on public.nexus_plans to service_role;

commit;
