-- Synthetic SST tenant and payment data. Never run against production.
BEGIN;

DO $$
BEGIN
 IF has_table_privilege('anon','public.nexus_sst_asaas_pilot_checkouts','SELECT')
    OR has_table_privilege('authenticated','public.nexus_sst_asaas_payment_events','INSERT')
    OR NOT has_table_privilege('service_role','public.nexus_sst_asaas_pilot_checkouts','SELECT')
 THEN RAISE EXCEPTION 'SST Asaas ledger exposed or service access absent'; END IF;
 IF NOT EXISTS (SELECT 1 FROM pg_tables
      WHERE schemaname='public' AND tablename='nexus_sst_asaas_pilot_checkouts' AND rowsecurity)
 THEN RAISE EXCEPTION 'SST Asaas RLS missing'; END IF;
 IF has_function_privilege('anon',
  'public.record_verified_nexus_sst_asaas_payment(uuid,text,text,text,text,date,text)','EXECUTE')
 THEN RAISE EXCEPTION 'SST settlement callable anonymously'; END IF;
END $$;

INSERT INTO auth.users (id,email) VALUES
 ('70000000-0000-4000-8000-000000000044','sst-user@example.test');
INSERT INTO public.nexus_plans
 (id,product_id,code,name,price_cents,currency,billing_interval_months,status,employee_limit)
 VALUES
 ('20000000-0000-4000-8000-000000000044','10000000-0000-4000-8000-000000000002','piloto','SST Piloto',0,'BRL',1,'active',50),
 ('20000000-0000-4000-8000-000000000045','10000000-0000-4000-8000-000000000002','essencial','SST Essencial',9700,'BRL',1,'active',50);
INSERT INTO public.organizations(id,name,email)
 VALUES ('30000000-0000-4000-8000-000000000044','Cliente Piloto','sst-user@example.test');
INSERT INTO public.organization_product_access
 (id,organization_id,product_id,plan_id,subscription_status,access_status,renews_at,billing_provider,contracted_price_cents)
 VALUES ('40000000-0000-4000-8000-000000000044',
 '30000000-0000-4000-8000-000000000044',
 '10000000-0000-4000-8000-000000000002',
 '20000000-0000-4000-8000-000000000044',
 'trial','suspended',current_date - 1,null,0);
INSERT INTO public.nexus_accounts(id,billing_organization_id,account_type,plan_id)
 VALUES ('50000000-0000-4000-8000-000000000044',
 '30000000-0000-4000-8000-000000000044',
 'single_company','20000000-0000-4000-8000-000000000044');
INSERT INTO public.employees(id,organization_id,active) VALUES
 ('80000000-0000-4000-8000-000000000044','30000000-0000-4000-8000-000000000044',true),
 ('80000000-0000-4000-8000-000000000045','30000000-0000-4000-8000-000000000044',true);
INSERT INTO public.nexus_sst_asaas_pilot_checkouts
 (id,organization_id,access_id,user_id,plan_id,company_name,owner_email,
  registration_number,amount_cents,billing_type,environment,state,provider_link_id,provider_link_url)
 VALUES
 ('60000000-0000-4000-8000-000000000044',
 '30000000-0000-4000-8000-000000000044',
 '40000000-0000-4000-8000-000000000044',
 '70000000-0000-4000-8000-000000000044',
 '20000000-0000-4000-8000-000000000045',
 'Cliente Piloto','sst-user@example.test','12345678000195',9700,'PIX','production',
 'ready','plink_sstfixture123','https://www.asaas.com/c/synthetic-fixture');
INSERT INTO public.nexus_sst_asaas_payment_events
 (provider_event_id,event_type,provider_payment_id,provider_link_id,provider_subscription_id)
 VALUES ('evt_sstfixture123','PAYMENT_RECEIVED','pay_sstfixture123',
 'plink_sstfixture123','sub_sstfixture123');

DO $$
DECLARE
 r jsonb;
BEGIN
 SELECT public.record_verified_nexus_sst_asaas_payment(
  '60000000-0000-4000-8000-000000000044',
  'evt_sstfixture123','pay_sstfixture123','cus_sstfixture123',
  'sub_sstfixture123',current_date+30,'RECEIVED'
 ) INTO r;
 IF r->>'applied'<>'true' THEN RAISE EXCEPTION 'SST conversion not applied'; END IF;

 IF (SELECT organization_id FROM public.organization_product_access
   WHERE id='40000000-0000-4000-8000-000000000044') <>
   '30000000-0000-4000-8000-000000000044'::uuid
 THEN RAISE EXCEPTION 'SST company identity changed'; END IF;
 IF NOT EXISTS (SELECT 1 FROM public.organization_product_access
   WHERE id='40000000-0000-4000-8000-000000000044'
    AND subscription_status='active' AND access_status='active'
    AND billing_provider='asaas'
    AND provider_subscription_id='sub_sstfixture123'
    AND plan_id='20000000-0000-4000-8000-000000000045')
 THEN RAISE EXCEPTION 'SST pilot was not reactivated in place'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.nexus_accounts
   WHERE billing_organization_id='30000000-0000-4000-8000-000000000044'
    AND plan_id='20000000-0000-4000-8000-000000000045')
 THEN RAISE EXCEPTION 'SST account plan not synchronized'; END IF;
 IF (SELECT count(*) FROM public.employees
   WHERE organization_id='30000000-0000-4000-8000-000000000044')<>2
 THEN RAISE EXCEPTION 'SST employee records lost'; END IF;
 IF (SELECT count(*) FROM public.nexus_payments
   WHERE provider='asaas' AND provider_payment_id='pay_sstfixture123')<>1
 THEN RAISE EXCEPTION 'SST verified payment missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.audit_logs
  WHERE action='NEXUS_SST_PILOT_CONVERTED_ASAAS'
   AND entity_id='40000000-0000-4000-8000-000000000044')
 THEN RAISE EXCEPTION 'SST conversion audit missing'; END IF;

 SELECT public.record_verified_nexus_sst_asaas_payment(
  '60000000-0000-4000-8000-000000000044',
  'evt_sstfixture123','pay_sstfixture123','cus_sstfixture123',
  'sub_sstfixture123',current_date+30,'RECEIVED'
 ) INTO r;
 IF r->>'reason'<>'payment_already_verified'
 THEN RAISE EXCEPTION 'SST payment replay not idempotent'; END IF;
END $$;


-- Expired recurring access may be suspended only after the configured grace.
DO $$
DECLARE
 r jsonb;
BEGIN
 UPDATE public.organization_product_access SET renews_at=current_date-2
 WHERE id='40000000-0000-4000-8000-000000000044';
 SELECT public.suspend_verified_nexus_sst_asaas_overdue(
  '60000000-0000-4000-8000-000000000044',current_date-2,7) INTO r;
 IF r->>'reason'<>'grace_not_elapsed' THEN RAISE EXCEPTION 'Grace was ignored'; END IF;

 UPDATE public.organization_product_access SET renews_at=current_date-9
 WHERE id='40000000-0000-4000-8000-000000000044';
 SELECT public.suspend_verified_nexus_sst_asaas_overdue(
  '60000000-0000-4000-8000-000000000044',current_date-9,7) INTO r;
 IF r->>'applied'<>'true' THEN RAISE EXCEPTION 'Verified overdue not suspended'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.organization_product_access
  WHERE id='40000000-0000-4000-8000-000000000044'
   AND subscription_status='past_due' AND access_status='suspended')
 THEN RAISE EXCEPTION 'SST overdue entitlement not suspended'; END IF;
 SELECT public.suspend_verified_nexus_sst_asaas_overdue(
  '60000000-0000-4000-8000-000000000044',current_date-9,7) INTO r;
 IF r->>'reason'<>'already_suspended' THEN
  RAISE EXCEPTION 'SST overdue suspension not idempotent'; END IF;
END $
INSERT INTO public.nexus_sst_asaas_payment_events
 (provider_event_id,event_type,provider_payment_id,provider_link_id,provider_subscription_id)
 VALUES ('evt_sstfixture124','PAYMENT_CONFIRMED','pay_sstfixture124',
 'plink_sstfixture123','sub_sstfixture123');
DO $$
DECLARE
 r jsonb;
BEGIN
 SELECT public.record_verified_nexus_sst_asaas_payment(
  '60000000-0000-4000-8000-000000000044',
  'evt_sstfixture124','pay_sstfixture124','cus_sstfixture123',
  'sub_sstfixture123',current_date+31,'CONFIRMED') INTO r;
 IF r->>'applied'<>'true' OR NOT EXISTS(
  SELECT 1 FROM public.organization_product_access
  WHERE id='40000000-0000-4000-8000-000000000044'
    AND access_status='active' AND subscription_status='active'
    AND provider_subscription_id='sub_sstfixture123')
 THEN RAISE EXCEPTION 'Paid renewal did not restore same SST company'; END IF;
 IF (SELECT count(*) FROM public.nexus_payments
  WHERE provider='asaas' AND organization_id='30000000-0000-4000-8000-000000000044')<>2
 THEN RAISE EXCEPTION 'SST recurring payments not deduplicated'; END IF;
END $

-- Confirm cross-company checkout cannot reuse another company's access id.
INSERT INTO public.organizations(id,name)
 VALUES('30000000-0000-4000-8000-000000000045','Empresa Invasora');
INSERT INTO public.organization_product_access
 (id,organization_id,product_id,plan_id,subscription_status,access_status,renews_at)
 VALUES('40000000-0000-4000-8000-000000000045',
 '30000000-0000-4000-8000-000000000044',
 '10000000-0000-4000-8000-000000000002',
 '20000000-0000-4000-8000-000000000044',
 'trial','active',current_date+15);
INSERT INTO public.nexus_sst_asaas_pilot_checkouts
 (id,organization_id,access_id,user_id,plan_id,company_name,owner_email,
  registration_number,amount_cents,billing_type,environment,state,provider_link_id)
 VALUES('60000000-0000-4000-8000-000000000045',
 '30000000-0000-4000-8000-000000000045',
 '40000000-0000-4000-8000-000000000045',
 '70000000-0000-4000-8000-000000000044',
 '20000000-0000-4000-8000-000000000045',
 'Empresa Invasora','sst-user@example.test','98765432000111',9700,'PIX','production',
 'ready','plink_sstfixture999');
INSERT INTO public.nexus_sst_asaas_payment_events
 (provider_event_id,event_type,provider_payment_id,provider_link_id)
 VALUES('evt_sstfixture999','PAYMENT_RECEIVED','pay_sstfixture999','plink_sstfixture999');

DO $$
DECLARE
 rejected boolean := false;
BEGIN
 BEGIN
  PERFORM public.record_verified_nexus_sst_asaas_payment(
   '60000000-0000-4000-8000-000000000045',
   'evt_sstfixture999','pay_sstfixture999','cus_sstfixture999',
   'sub_sstfixture999',current_date+30,'RECEIVED');
 EXCEPTION WHEN OTHERS THEN rejected := true;
 END;
 IF NOT rejected THEN RAISE EXCEPTION 'Cross-org SST settlement unexpectedly accepted'; END IF;
 IF EXISTS (SELECT 1 FROM public.nexus_sst_asaas_verified_payments
   WHERE provider_payment_id='pay_sstfixture999')
 THEN RAISE EXCEPTION 'Cross-org payment was recorded'; END IF;
END $$;

ROLLBACK;
SELECT 'PASS: SST payment conversion retains organization, preserves data and rejects cross-org/replay' AS result;
