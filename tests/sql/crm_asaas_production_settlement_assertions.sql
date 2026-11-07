-- EPHEMERAL POSTGRESQL 17 ONLY. Synthetic Asaas production settlement.
-- No provider API, real payment, customer or tenant is ever created.
DO $$
BEGIN
 IF has_table_privilege('anon','public.nexus_crm_asaas_production_verified_payments','SELECT')
   OR has_table_privilege('authenticated','public.nexus_crm_asaas_production_verified_payments','INSERT')
   OR NOT has_table_privilege('service_role','public.nexus_crm_asaas_production_verified_payments','SELECT')
   OR NOT has_table_privilege('service_role','public.nexus_crm_asaas_production_verified_payments','UPDATE')
 THEN RAISE EXCEPTION 'Production verified payment table privilege failure'; END IF;
 IF has_function_privilege('anon','public.reserve_nexus_crm_asaas_production_verified_payment(uuid,text,text,text,bigint,text)','EXECUTE')
   OR has_function_privilege('authenticated','public.claim_nexus_crm_asaas_production_provisioning(uuid,text)','EXECUTE')
   OR has_function_privilege('anon','public.begin_nexus_crm_asaas_production_provisioning(uuid,text)','EXECUTE')
   OR has_function_privilege('authenticated','public.complete_nexus_crm_asaas_production_provisioning(uuid,text)','EXECUTE')
   OR NOT has_function_privilege('service_role','public.reserve_nexus_crm_asaas_production_verified_payment(uuid,text,text,text,bigint,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Production financial functions must be service only'; END IF;
END $$;

BEGIN;
INSERT INTO public.nexus_sales
 (id,product_id,plan_id,sale_status,provider,environment,source,billing_mode,
  billing_cycle_months,checkout_amount_cents,asaas_checkout_id,registration_number,email)
 VALUES ('50000000-0000-4000-8000-000000000114',
 '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
 'checkout_created','asaas','production','site-captacao','recurring',1,7900,
 'plink_prodfixture123','66666666000199','newprod@example.test');
INSERT INTO public.nexus_crm_asaas_production_events
 (provider_event_id,event_type,resource_id,payload)
 VALUES ('asaas:evt_prodfixture1234','PAYMENT_RECEIVED','pay_prodfixture1234',
 '{"event":"PAYMENT_RECEIVED","resource":{"id":"pay_prodfixture1234","paymentLink":"plink_prodfixture123","subscription":"sub_prodfixture123","billingType":"PIX","value":79}}'::jsonb);

DO $$
DECLARE v jsonb; n integer;
BEGIN
  -- A Sandbox sale can never reserve a real production payment, even with a
  -- valid production webhook event ID and amount.
  v:=public.reserve_nexus_crm_asaas_production_verified_payment(
   '50000000-0000-4000-8000-000000000001','asaas:evt_prodfixture1234',
   'pay_prodfixture1234','sub_prodfixture123',7900,'PIX');
  IF v->>'reason'<>'sale_not_eligible' THEN RAISE EXCEPTION 'Sandbox sale cross-wired: %',v; END IF;
  v:=public.reserve_nexus_crm_asaas_production_verified_payment(
   '50000000-0000-4000-8000-000000000114','asaas:evt_prodfixture1234',
   'pay_prodfixture1234','sub_prodfixture123',7900,'PIX');
  IF v->>'decision'<>'reserved_for_review' THEN RAISE EXCEPTION 'Production reserve failed: %',v; END IF;
  v:=public.reserve_nexus_crm_asaas_production_verified_payment(
   '50000000-0000-4000-8000-000000000114','asaas:evt_prodfixture1234',
   'pay_prodfixture1234','sub_prodfixture123',7900,'PIX');
  IF v->>'decision'<>'reserved_for_review' THEN RAISE EXCEPTION 'Repeat reserve not idempotent: %',v; END IF;
  SELECT count(*) INTO n FROM public.nexus_crm_asaas_production_verified_payments
   WHERE provider_payment_id='pay_prodfixture1234';
  IF n<>1 THEN RAISE EXCEPTION 'Duplicate payment reservation'; END IF;
  v:=public.claim_nexus_crm_asaas_production_provisioning(
    '50000000-0000-4000-8000-000000000114','pay_prodfixture1234');
  IF v->>'decision'<>'provision_ready' THEN RAISE EXCEPTION 'Production claim failed: %',v; END IF;
  v:=public.claim_nexus_crm_asaas_production_provisioning(
    '50000000-0000-4000-8000-000000000114','pay_prodfixture1234');
  IF v->>'decision'<>'already_claimed' THEN RAISE EXCEPTION 'Claim duplicate not idempotent: %',v; END IF;
  v:=public.begin_nexus_crm_asaas_production_provisioning(
    '50000000-0000-4000-8000-000000000114','pay_prodfixture1234');
  IF v->>'decision'<>'acquired' THEN RAISE EXCEPTION 'Lease not acquired: %',v; END IF;
  v:=public.begin_nexus_crm_asaas_production_provisioning(
    '50000000-0000-4000-8000-000000000114','pay_prodfixture1234');
  IF v->>'reason'<>'lease_not_available' THEN RAISE EXCEPTION 'Duplicate lease was allowed: %',v; END IF;
  -- No Auth user, tenant, entitlement or receipt created by this SQL:
  -- completion MUST be refused despite a financially verified sale.
  v:=public.complete_nexus_crm_asaas_production_provisioning(
    '50000000-0000-4000-8000-000000000114','pay_prodfixture1234');
  IF v->>'reason'<>'sale_incomplete' THEN RAISE EXCEPTION 'Unprovisioned tenant completed: %',v; END IF;
  SELECT count(*) INTO n FROM public.organizations where registration_number='66666666000199';
  IF n<>0 THEN RAISE EXCEPTION 'SQL created an organization'; END IF;
  SELECT count(*) INTO n FROM public.nexus_payments where provider_payment_id='pay_prodfixture1234';
  IF n<>0 THEN RAISE EXCEPTION 'SQL created a payment'; END IF;
  SELECT count(*) INTO n FROM public.nexus_sales
    WHERE id='50000000-0000-4000-8000-000000000114'
      AND sale_status='paid' AND paid_at IS NOT NULL;
  IF n<>1 THEN RAISE EXCEPTION 'Financial claim did not advance sale atomically'; END IF;
END $$;
ROLLBACK;
SELECT 'PASS: production Asaas reserve, claim, lease, idempotency and no-tenant guard' AS result;
