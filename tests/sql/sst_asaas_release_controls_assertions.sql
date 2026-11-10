-- Synthetic PostgreSQL 17 only. Check closed-by-default release and privilege isolation.
BEGIN;
DO $$
BEGIN
 IF has_table_privilege('anon','public.nexus_sst_asaas_release_controls','SELECT')
 OR has_table_privilege('authenticated','public.nexus_sst_asaas_release_controls','UPDATE')
 OR NOT has_table_privilege('service_role','public.nexus_sst_asaas_release_controls','SELECT')
 THEN RAISE EXCEPTION 'SST release configuration exposed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_tables WHERE schemaname='public'
  AND tablename='nexus_sst_asaas_release_controls' AND rowsecurity)
 THEN RAISE EXCEPTION 'SST release controls RLS disabled'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.nexus_sst_asaas_release_controls
  WHERE id='production' AND checkout_enabled=false AND reconciliation_enabled=false
   AND worker_heartbeat_at IS NULL AND asaas_connection_verified_at IS NULL)
 THEN RAISE EXCEPTION 'SST finance not fail-closed by default'; END IF;
END $$;
UPDATE public.nexus_sst_asaas_release_controls
 SET checkout_enabled=true, reconciliation_enabled=true,
     asaas_connection_verified_at=now(),
     webhook_secret_present_at=now(),
     worker_heartbeat_at=now()
 WHERE id='production';
DO $$
BEGIN
 IF (SELECT count(*) FROM public.nexus_sst_asaas_release_controls
  WHERE checkout_enabled=true AND reconciliation_enabled=true)<>1
 THEN RAISE EXCEPTION 'SST service switch cannot activate'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS: isolated SST production release is closed-by-default' AS result;
