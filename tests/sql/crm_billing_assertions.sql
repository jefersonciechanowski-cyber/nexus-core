-- Runs after fixture + the THREE actual SQL draft files. Zero real customers.
-- Raise immediately if idempotency, payment checks or courtesy preservation fail.
DO $$
DECLARE r jsonb; x bigint;
BEGIN
  -- Payment event from an authenticated inbox; reservation is never paid.
  r := public.reserve_nexus_crm_asaas_verified_payment(
    '50000000-0000-4000-8000-000000000001','asaas:evt_abcdef123456',
    'pay_abcdef123','sub_abcdef123',7900,'PIX');
  IF r->>'decision' <> 'reserved_for_review' THEN RAISE EXCEPTION 'reserve failed: %',r; END IF;
  r := public.reserve_nexus_crm_asaas_verified_payment(
    '50000000-0000-4000-8000-000000000001','asaas:evt_abcdef123456',
    'pay_abcdef123','sub_abcdef123',7900,'PIX');
  IF r->>'decision' <> 'reserved_for_review' THEN RAISE EXCEPTION 'duplicate reservation not idempotent: %',r; END IF;
  SELECT count(*) INTO x FROM public.nexus_crm_asaas_verified_payments;
  IF x<>1 THEN RAISE EXCEPTION 'duplicate payment reservation!'; END IF;

  -- Rival sale cannot claim another sale's subscription.
  r := public.reserve_nexus_crm_asaas_verified_payment(
    '50000000-0000-4000-8000-000000000002','asaas:evt_defghi123456',
    'pay_defghi123','sub_abcdef123',7900,'PIX');
  IF r->>'reason' <> 'subscription_reserved_elsewhere' THEN RAISE EXCEPTION 'cross-sale subscription accepted: %',r; END IF;
  -- A second subscription cannot be silently associated with this sale.
  r := public.reserve_nexus_crm_asaas_verified_payment(
    '50000000-0000-4000-8000-000000000001','asaas:evt_other123456',
    'pay_other123','sub_other123',7900,'PIX');
  IF r->>'reason'<>'sale_has_another_subscription' THEN RAISE EXCEPTION 'second subscription accepted: %',r; END IF;
  -- Not permitted to change the amount of a verified payment.
  r := public.reserve_nexus_crm_asaas_verified_payment(
    '50000000-0000-4000-8000-000000000001','asaas:evt_abcdef123456',
    'pay_abcdef123','sub_abcdef123',11900,'PIX');
  IF r->>'decision' <> 'manual_review' THEN RAISE EXCEPTION 'wrong price accepted: %',r; END IF;
  -- Wrong method cannot be accepted.
  r := public.reserve_nexus_crm_asaas_verified_payment(
    '50000000-0000-4000-8000-000000000001','asaas:evt_abcdef123456',
    'pay_abcdef123','sub_abcdef123',7900,'BOLETO');
  IF r->>'decision'<>'manual_review' THEN RAISE EXCEPTION 'wrong billing method accepted: %',r; END IF;

  -- Payment transition is atomic, can occur once and grants no CRM access.
  r := public.claim_nexus_crm_asaas_provisioning(
    '50000000-0000-4000-8000-000000000001','pay_abcdef123');
  IF r->>'decision'<>'provision_ready' THEN RAISE EXCEPTION 'claim failed: %',r; END IF;
  r := public.claim_nexus_crm_asaas_provisioning(
    '50000000-0000-4000-8000-000000000001','pay_abcdef123');
  IF r->>'decision'<>'already_claimed' THEN RAISE EXCEPTION 'claim reentry changed state: %',r; END IF;
  SELECT count(*) INTO x FROM public.nexus_sales WHERE sale_status='paid' AND provider='asaas';
  IF x<>1 THEN RAISE EXCEPTION 'unexpected sale status count!'; END IF;
  SELECT count(*) INTO x FROM public.organization_product_access;
  IF x<>3 THEN RAISE EXCEPTION 'claim modified contracts!'; END IF;
  SELECT count(*) INTO x FROM public.nexus_payments;
  IF x<>0 THEN RAISE EXCEPTION 'claim inserted provider payments too early!'; END IF;

  -- Different link+invoice, same CPF/CNPJ as an already claimed checkout.
  -- Must not create a second paid sale/organization with the same identity.
  INSERT INTO public.nexus_sales(id,product_id,plan_id,sale_status,provider,
    environment,source,billing_mode,billing_cycle_months,checkout_amount_cents,
    asaas_checkout_id,registration_number,email) VALUES
    ('50000000-0000-4000-8000-000000000005',
     '10000000-0000-4000-8000-000000000001',
     '20000000-0000-4000-8000-000000000001',
     'checkout_created','asaas','sandbox','site-captacao','recurring',1,7900,
     'plink_second_identity','44444444000199','different-owner@example.test');
  INSERT INTO public.nexus_payment_webhook_events(provider_event_id,provider,event_type,payload)
  VALUES ('asaas:evt_sameidentity1','asaas','PAYMENT_RECEIVED',
    '{"event":"PAYMENT_RECEIVED","resource":{"id":"pay_sameidentity1",
       "paymentLink":"plink_second_identity","subscription":"sub_secondidentity1",
       "billingType":"PIX","value":79}}'::jsonb);
  r:=public.reserve_nexus_crm_asaas_verified_payment(
    '50000000-0000-4000-8000-000000000005','asaas:evt_sameidentity1',
    'pay_sameidentity1','sub_secondidentity1',7900,'PIX');
  IF r->>'decision'<>'reserved_for_review' THEN
    RAISE EXCEPTION 'second identity fixture cannot reserve: %',r;
  END IF;
  r:=public.claim_nexus_crm_asaas_provisioning(
    '50000000-0000-4000-8000-000000000005','pay_sameidentity1');
  IF r->>'reason'<>'identity_already_claimed' THEN
    RAISE EXCEPTION 'same company claimed twice via new payment link: %',r;
  END IF;
  SELECT count(*) INTO x FROM public.nexus_sales
    WHERE provider='asaas' AND sale_status='paid';
  IF x<>1 THEN RAISE EXCEPTION 'duplicate paid company was created'; END IF;

  -- A single free trial per email AND per document, separate from courtesy.
  IF NOT public.reserve_nexus_crm_trial(
    '60000000-0000-4000-8000-000000000001',repeat('a',64),repeat('b',64),15) THEN
    RAISE EXCEPTION 'trial reservation failed';
  END IF;
  IF public.reserve_nexus_crm_trial(
    '60000000-0000-4000-8000-000000000002',repeat('a',64),repeat('c',64),30) THEN
    RAISE EXCEPTION 'duplicate trial email accepted';
  END IF;
  IF public.reserve_nexus_crm_trial(
    '60000000-0000-4000-8000-000000000003',repeat('d',64),repeat('b',64),30) THEN
    RAISE EXCEPTION 'duplicate trial document accepted';
  END IF;
  IF NOT public.confirm_nexus_crm_trial(
    '60000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'trial confirmation failed';
  END IF;
  IF public.confirm_nexus_crm_trial(
    '60000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'trial duplicate confirmation accepted';
  END IF;

  r:=public.expire_nexus_crm_trial_access(
    '40000000-0000-4000-8000-000000000001',current_date - 1);
  IF r->>'applied'<>'true' THEN RAISE EXCEPTION 'trial expiration failed: %',r; END IF;
  r:=public.expire_nexus_crm_trial_access(
    '40000000-0000-4000-8000-000000000001',current_date - 1);
  IF r->>'applied'<>'false' THEN RAISE EXCEPTION 'trial re-expired: %',r; END IF;
  r:=public.expire_nexus_crm_trial_access(
    '40000000-0000-4000-8000-000000000002',current_date - 1);
  IF r->>'applied'<>'false' THEN RAISE EXCEPTION 'courtesy expired: %',r; END IF;
  r:=public.expire_nexus_crm_trial_access(
    '40000000-0000-4000-8000-000000000003',current_date - 1);
  IF r->>'applied'<>'false' THEN RAISE EXCEPTION 'Stripe contract expired: %',r; END IF;
  SELECT count(*) INTO x FROM public.organization_product_access
    WHERE subscription_status='active' AND access_status='active';
  IF x<>2 THEN RAISE EXCEPTION 'courtesy/Stripe altered!'; END IF;
END $$;

DO $$
BEGIN
  IF has_table_privilege('anon','public.nexus_crm_trial_claims','SELECT')
    OR has_table_privilege('authenticated','public.nexus_crm_trial_claims','INSERT')
    OR has_table_privilege('anon','public.nexus_crm_asaas_verified_payments','SELECT')
    OR has_function_privilege('anon','public.claim_nexus_crm_asaas_provisioning(uuid,text)','EXECUTE')
    OR has_function_privilege('authenticated','public.reserve_nexus_crm_trial(uuid,text,text,integer)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.confirm_nexus_crm_trial(uuid,uuid,uuid)','EXECUTE') THEN
      RAISE EXCEPTION 'RLS/roles: unauthorized privilege on financial functions or tables';
  END IF;
END $$;
SELECT 'PG17 CRM billing/trial SQL drafts: all isolated integration assertions passed' AS result;
