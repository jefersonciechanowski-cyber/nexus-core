-- POSTGRESQL CI ONLY (synthetic schema), not a production migration.
DO $$
DECLARE d jsonb; n int;
BEGIN
  d:=public.preflight_nexus_crm_public_identity('88888888000122','brand-new@example.test');
  IF d->>'eligible'<>'true' THEN RAISE EXCEPTION 'new CRM account rejected: %',d; END IF;
  d:=public.preflight_nexus_crm_public_identity('22222222000199','new@example.test');
  IF d->>'reason'<>'existing_identity' THEN RAISE EXCEPTION 'courtesy document was chargeable: %',d; END IF;
  d:=public.preflight_nexus_crm_public_identity('88888888000122','COURTESY@example.test');
  IF d->>'reason'<>'existing_identity' THEN RAISE EXCEPTION 'agency courtesy email was chargeable: %',d; END IF;
  insert into auth.users(id,email) values('70000000-0000-4000-8000-000000000001','legacy-account@example.test');
  d:=public.preflight_nexus_crm_public_identity('88888888000122','LEGACY-ACCOUNT@example.test');
  IF d->>'reason'<>'existing_identity' THEN RAISE EXCEPTION 'auth login of another Nexus product was chargeable: %',d; END IF;
  d:=public.preflight_nexus_crm_public_identity('abc','bad email');
  IF d->>'reason'<>'invalid_identity' THEN RAISE EXCEPTION 'malformed identity accepted: %',d; END IF;
  IF has_function_privilege('anon','public.preflight_nexus_crm_public_identity(text,text)','EXECUTE')
    OR has_function_privilege('authenticated','public.preflight_nexus_crm_public_identity(text,text)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.preflight_nexus_crm_public_identity(text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'identity RPC privilege leak';
  END IF;

  -- Legacy site-captacao intake is NOT a public Stripe checkout and must
  -- remain unaffected even with duplicate marketing leads from same email.
  insert into public.nexus_sales(id,product_id,plan_id,sale_status,provider,
    environment,source,billing_mode,billing_cycle_months,checkout_amount_cents,
    registration_number,email,external_reference)
  values('71000000-0000-4000-8000-000000000010',
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    'lead','stripe','sandbox','site-captacao','recurring',1,7900,
    '88888888000122','first@example.test','legacy-crm-lead');

  -- Stripe Checkout must be unique even when a second request changes plan
  -- or email. Both collision paths are exercised against actual UNIQUE indexes.
  insert into public.nexus_sales(
    id,product_id,plan_id,sale_status,provider,environment,source,billing_mode,
    billing_cycle_months,checkout_amount_cents,registration_number,email,external_reference)
  values('71000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    'lead','stripe','sandbox','site-captacao','recurring',1,7900,'88888888000122','first@example.test','crm-monthly-original');
  BEGIN
    insert into public.nexus_sales(id,product_id,plan_id,sale_status,provider,
      environment,source,billing_mode,billing_cycle_months,checkout_amount_cents,
      registration_number,email,external_reference)
    values('71000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',
      'lead','stripe','sandbox','site-captacao','recurring',1,11900,'88888888000122','second@example.test','crm-monthly-parallel-document');
    RAISE EXCEPTION 'different email/plan bypassed document unique index';
  EXCEPTION WHEN unique_violation THEN NULL; END;
  BEGIN
    insert into public.nexus_sales(id,product_id,plan_id,sale_status,provider,
      environment,source,billing_mode,billing_cycle_months,checkout_amount_cents,
      registration_number,email,external_reference)
    values('71000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',
      'lead','stripe','sandbox','site-captacao','recurring',1,11900,'99999999000122','FIRST@example.test','crm-monthly-parallel-email');
    RAISE EXCEPTION 'different document bypassed case-insensitive email unique index';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- Failed/expired purchases can be restarted safely, but not an active sale.
  update public.nexus_sales set sale_status='expired'
    where id='71000000-0000-4000-8000-000000000001';
  insert into public.nexus_sales(id,product_id,plan_id,sale_status,provider,
    environment,source,billing_mode,billing_cycle_months,checkout_amount_cents,
    registration_number,email,external_reference)
  values('71000000-0000-4000-8000-000000000004',
    '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
    'lead','stripe','sandbox','site-captacao','recurring',1,7900,'88888888000122','first@example.test','crm-monthly-retry-after-expire');
  select count(*) into n from public.nexus_sales
    where provider='stripe' and source='site-captacao'
      and sale_status='lead' and registration_number='88888888000122';
  IF n<>1 THEN RAISE EXCEPTION 'repeat attempt created more than one Stripe lead: %',n; END IF;
END $$;
SELECT 'PASS: Stripe-first existing email/doc guards, and unique races on email or document' AS result;
