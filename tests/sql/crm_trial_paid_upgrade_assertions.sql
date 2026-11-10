-- Executed ONLY in an ephemeral PG17 service in GitHub Actions.
DO $assert$
DECLARE r jsonb; v_access public.organization_product_access%ROWTYPE;
        org_count integer; sale_count integer;
BEGIN
 IF pg_catalog.has_function_privilege('anon','public.complete_nexus_crm_trial_paid_upgrade(uuid,text)','EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated','public.complete_nexus_crm_trial_paid_upgrade(uuid,text)','EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role','public.complete_nexus_crm_trial_paid_upgrade(uuid,text)','EXECUTE')
 THEN RAISE EXCEPTION 'Upgrade RPC must be restricted to service_role'; END IF;

 SELECT pg_catalog.count(*) INTO org_count FROM public.organizations;
 SELECT pg_catalog.count(*) INTO sale_count FROM public.nexus_sales;

 -- Active trial: exact paid Asaas receipt upgrades the SAME access and tenant.
 SELECT public.complete_nexus_crm_trial_paid_upgrade(
   '50000000-0000-4000-8000-000000000011','pay_upgrade11') INTO r;
 IF r->>'decision'<>'upgraded'
   OR r->>'access_id'<>'40000000-0000-4000-8000-000000000011'
   OR r->>'crm_tenant_id'<>'60000000-0000-4000-8000-000000000011'
 THEN RAISE EXCEPTION 'Active trial did not preserve old tenant: %',r; END IF;

 SELECT * INTO v_access FROM public.organization_product_access
 WHERE id='40000000-0000-4000-8000-000000000011';
 IF v_access.subscription_status<>'active' OR v_access.access_status<>'active'
    OR v_access.billing_provider<>'asaas' OR v_access.provider_subscription_id<>'sub_upgrade11'
    OR v_access.contracted_price_cents<>7900 OR v_access.billing_mode<>'recurring'
    OR v_access.external_tenant_id<>'60000000-0000-4000-8000-000000000011'
 THEN RAISE EXCEPTION 'Upgraded trial access contract was not correct'; END IF;

 -- Exact replay returns idempotent success, never duplicates an organization.
 SELECT public.complete_nexus_crm_trial_paid_upgrade(
   '50000000-0000-4000-8000-000000000011','pay_upgrade11') INTO r;
 IF r->>'decision'<>'already_completed' THEN RAISE EXCEPTION 'Replay not idempotent: %',r; END IF;

 -- After the 15 days, trial is past_due/suspended; a RECEIVED payment MUST
 -- reactivate that very same CRM tenant without discarding its data.
 SELECT public.complete_nexus_crm_trial_paid_upgrade(
   '50000000-0000-4000-8000-000000000012','pay_upgrade12') INTO r;
 IF r->>'decision'<>'upgraded'
   OR r->>'crm_tenant_id'<>'60000000-0000-4000-8000-000000000012'
 THEN RAISE EXCEPTION 'Expired trial failed reactivation: %',r; END IF;
 SELECT * INTO v_access FROM public.organization_product_access
 WHERE id='40000000-0000-4000-8000-000000000012';
 IF v_access.subscription_status<>'active' OR v_access.access_status<>'active'
   OR v_access.external_tenant_id<>'60000000-0000-4000-8000-000000000012'
 THEN RAISE EXCEPTION 'Expired tenant was not recovered intact'; END IF;

 -- CONFIRMED but not RECEIVED cannot prove customer funds.
 SELECT public.complete_nexus_crm_trial_paid_upgrade(
   '50000000-0000-4000-8000-000000000013','pay_upgrade13') INTO r;
 IF r->>'decision'<>'manual_review' OR r->>'reason'<>'verified_receipt_missing'
 THEN RAISE EXCEPTION 'Unreceived payment incorrectly accepted: %',r; END IF;
 SELECT * INTO v_access FROM public.organization_product_access
 WHERE id='40000000-0000-4000-8000-000000000013';
 IF v_access.subscription_status<>'trial' OR v_access.contracted_price_cents<>0
 THEN RAISE EXCEPTION 'Unreceived payment modified trial'; END IF;

 -- Existing courtesies can NEVER be silently converted to paid plans.
 SELECT public.complete_nexus_crm_trial_paid_upgrade(
   '50000000-0000-4000-8000-000000000014','pay_upgrade14') INTO r;
 IF r->>'decision'<>'manual_review'
 THEN RAISE EXCEPTION 'Courtesy access incorrectly accepted: %',r; END IF;
 SELECT * INTO v_access FROM public.organization_product_access
 WHERE id='40000000-0000-4000-8000-000000000014';
 IF v_access.commercial_condition<>'courtesy' OR v_access.contracted_price_cents<>0
 THEN RAISE EXCEPTION 'Courtesy access was modified'; END IF;

 -- A forged or wrong payment ID cannot convert a trial.
 SELECT public.complete_nexus_crm_trial_paid_upgrade(
   '50000000-0000-4000-8000-000000000013','pay_wrong_user_123') INTO r;
 IF r->>'decision'<>'manual_review' THEN RAISE EXCEPTION 'Wrong receipt accepted'; END IF;

 IF (SELECT pg_catalog.count(*) FROM public.organizations)<>org_count
   OR (SELECT pg_catalog.count(*) FROM public.nexus_sales)<>sale_count
 THEN RAISE EXCEPTION 'Upgrade created a duplicate organization or sale'; END IF;
END;
$assert$;
