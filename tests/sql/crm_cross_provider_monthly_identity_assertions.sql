-- Isolated PostgreSQL 17 test after crm_billing_fixture.sql and index DDL.
-- It must never run against real customer data.
INSERT INTO public.nexus_sales(id,product_id,plan_id,sale_status,provider,
environment,source,billing_mode,billing_cycle_months,registration_number,email,external_reference)
VALUES('d0000000-0000-4000-8000-000000000001',
'10000000-0000-4000-8000-000000000001',
'20000000-0000-4000-8000-000000000001',
'checkout_created','stripe','sandbox','site-captacao','recurring',1,
'66666666000199','first@example.test','crm-monthly-demo-001');

DO $$
DECLARE doc_conflict boolean:=false;
        email_conflict boolean:=false;
BEGIN
  BEGIN
    INSERT INTO public.nexus_sales(id,product_id,plan_id,sale_status,provider,
      environment,source,billing_mode,billing_cycle_months,registration_number,email,external_reference)
    VALUES('d0000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'lead','asaas','sandbox','site-captacao','recurring',1,
      '66666666000199','other@example.test','crm-asaas-monthly-demo-002');
  EXCEPTION WHEN unique_violation THEN doc_conflict:=true; END;

  BEGIN
    INSERT INTO public.nexus_sales(id,product_id,plan_id,sale_status,provider,
      environment,source,billing_mode,billing_cycle_months,registration_number,email,external_reference)
    VALUES('d0000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'lead','asaas','sandbox','site-captacao','recurring',1,
      '77777777000199','FIRST@EXAMPLE.TEST','crm-asaas-monthly-demo-003');
  EXCEPTION WHEN unique_violation THEN email_conflict:=true; END;
  IF NOT doc_conflict OR NOT email_conflict THEN
    RAISE EXCEPTION 'Failed to block cross-provider monthly identity duplication';
  END IF;
END $$;

-- A Sandbox record must not block a legitimate live identity.
INSERT INTO public.nexus_sales(id,product_id,plan_id,sale_status,provider,
  environment,source,billing_mode,billing_cycle_months,registration_number,email,external_reference)
VALUES('d0000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'lead','asaas','production','site-captacao','recurring',1,
  '66666666000199','first@example.test','crm-asaas-monthly-demo-004');

-- Do not index courtesy, old-yearly or manual-review records.
INSERT INTO public.nexus_sales(id,product_id,plan_id,sale_status,provider,
  environment,source,billing_mode,billing_cycle_months,registration_number,email,external_reference)
VALUES('d0000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000001',
  'manual_review','asaas','sandbox','site-captacao','recurring',1,
  '66666666000199','first@example.test','crm-asaas-monthly-demo-005');

DO $$
BEGIN
  IF (SELECT count(*) FROM public.nexus_sales
      WHERE id::text LIKE 'd0000000-%') <> 3 THEN
    RAISE EXCEPTION 'Unexpected number of persisted fixture sales';
  END IF;
END $$;
