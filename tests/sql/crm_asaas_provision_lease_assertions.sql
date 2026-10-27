-- Only synthetic CI data: verify one-time provisioning lease and completion.
DO $$
DECLARE v jsonb; n integer;
BEGIN
  v:=public.begin_nexus_crm_asaas_provisioning(
    '50000000-0000-4000-8000-000000000001','pay_abcdef123');
  IF v->>'decision'<>'acquired' THEN RAISE EXCEPTION 'lease not acquired: %',v;END IF;
  v:=public.begin_nexus_crm_asaas_provisioning(
    '50000000-0000-4000-8000-000000000001','pay_abcdef123');
  IF v->>'reason'<>'lease_not_available' THEN RAISE EXCEPTION 'same lease acquired twice: %',v;END IF;
  v:=public.complete_nexus_crm_asaas_provisioning(
    '50000000-0000-4000-8000-000000000001','pay_abcdef123');
  IF v->>'reason'<>'sale_incomplete' THEN RAISE EXCEPTION 'completed before tenant: %',v;END IF;

  INSERT INTO public.organizations(id,registration_number,email) VALUES
    ('30000000-0000-4000-8000-000000000005','44444444000199','new@example.test');
  INSERT INTO public.organization_product_access(
    id,organization_id,product_id,subscription_status,access_status,
    billing_provider,commercial_condition,contracted_price_cents,
    provider_subscription_id,external_tenant_id)
  VALUES ('40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000005',
    '10000000-0000-4000-8000-000000000001','active','active',
    'asaas','standard',7900,'sub_abcdef123','fake_crm_tenant');
  -- Marking the sale provisioned without a financial receipt MUST fail.
  UPDATE public.nexus_sales SET sale_status='provisioned',
    organization_id='30000000-0000-4000-8000-000000000005',
    user_id='40000000-0000-4000-8000-000000000005',
    provisioned_at=pg_catalog.now()
  WHERE id='50000000-0000-4000-8000-000000000001';
  v:=public.complete_nexus_crm_asaas_provisioning(
    '50000000-0000-4000-8000-000000000001','pay_abcdef123');
  IF v->>'reason'<>'financial_receipt_missing' THEN RAISE EXCEPTION 'completed without receipt: %',v;END IF;

  INSERT INTO public.nexus_payments(
    provider_payment_id,provider,access_id,organization_id,
    provider_subscription_id,amount_cents)
  VALUES ('pay_abcdef123','asaas',
    '40000000-0000-4000-8000-000000000005',
    '30000000-0000-4000-8000-000000000005','sub_abcdef123',7900);
  v:=public.complete_nexus_crm_asaas_provisioning(
    '50000000-0000-4000-8000-000000000001','pay_abcdef123');
  IF v->>'decision'<>'completed' THEN RAISE EXCEPTION 'completion failed: %',v;END IF;
  v:=public.complete_nexus_crm_asaas_provisioning(
    '50000000-0000-4000-8000-000000000001','pay_abcdef123');
  IF v->>'decision'<>'already_provisioned' THEN RAISE EXCEPTION 'completion repeated: %',v;END IF;
  SELECT count(*) INTO n FROM public.nexus_crm_asaas_verified_payments
    WHERE provider_payment_id='pay_abcdef123' AND decision='provisioned';
  IF n<>1 THEN RAISE EXCEPTION 'missing final exactly-once receipt';END IF;
  SELECT count(*) INTO n FROM public.organization_product_access
    WHERE commercial_condition='courtesy' AND access_status='active';
  IF n<>1 THEN RAISE EXCEPTION 'agency courtesy changed';END IF;
END $$;
DO $$
BEGIN
 IF has_function_privilege('anon','public.begin_nexus_crm_asaas_provisioning(uuid,text)','EXECUTE')
  OR has_function_privilege('authenticated','public.complete_nexus_crm_asaas_provisioning(uuid,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Public provisioning lease callable';
 END IF;
END $$;
SELECT 'PASS: Asaas exclusive provisioning lease, receipt-before-completion and courtesy isolation' AS result;
