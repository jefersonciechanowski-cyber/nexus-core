-- Run in ephemeral PostgreSQL 17 CI only, after the migration above.
DO $$
DECLARE
  first_count integer;
BEGIN
  IF has_table_privilege('anon','public.nexus_crm_asaas_production_events','SELECT')
    OR has_table_privilege('authenticated','public.nexus_crm_asaas_production_events','INSERT')
    OR NOT has_table_privilege('service_role','public.nexus_crm_asaas_production_events','SELECT')
    OR NOT has_table_privilege('service_role','public.nexus_crm_asaas_production_events','INSERT')
    THEN RAISE EXCEPTION 'Webhook production privilege isolation failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_tables WHERE schemaname='public'
    AND tablename='nexus_crm_asaas_production_events'
    AND rowsecurity = true
  ) THEN RAISE EXCEPTION 'Webhook production RLS missing'; END IF;
  SELECT count(*) INTO first_count FROM public.nexus_crm_asaas_production_events;
  IF first_count<>0 THEN RAISE EXCEPTION 'Unexpected events in test table'; END IF;
END $$;
BEGIN;
INSERT INTO public.nexus_crm_asaas_production_events
  (provider_event_id,event_type,resource_id,payload)
VALUES ('asaas:evt_livefixture123456','PAYMENT_RECEIVED','pay_test123456',
 '{"event":"PAYMENT_RECEIVED","resource":{"id":"pay_test123456","value":79}}'::jsonb);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.nexus_crm_asaas_production_events
    WHERE environment='production')<>1 THEN
    RAISE EXCEPTION 'Webhook production fixture not isolated';
  END IF;
END $$;
ROLLBACK;
SELECT 'PASS: production events isolated with RLS, privileges and synthetic test' AS result;
