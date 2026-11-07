-- Isolated PostgreSQL 17 synthetic Asaas renewal test. Never touch live data.
DO $$
BEGIN
 IF has_function_privilege('anon',
 'public.record_nexus_crm_asaas_production_renewal(uuid,uuid,text,text,text,bigint,text,text,date,date)','EXECUTE')
  OR has_function_privilege('authenticated',
 'public.record_nexus_crm_asaas_production_renewal(uuid,uuid,text,text,text,bigint,text,text,date,date)','EXECUTE')
  OR NOT has_function_privilege('service_role',
 'public.record_nexus_crm_asaas_production_renewal(uuid,uuid,text,text,text,bigint,text,text,date,date)','EXECUTE')
 THEN RAISE EXCEPTION 'Live renewal RPC must be service-role only';END IF;
END $$;

BEGIN;
INSERT INTO public.organizations(id,registration_number,email) VALUES
 ('30000000-0000-4000-8000-000000000114','66666666000199','renewal@example.test');
INSERT INTO public.organization_product_access(
  id,organization_id,product_id,plan_id,subscription_status,access_status,
  billing_provider,billing_mode,billing_cycle_months,commercial_condition,
  contracted_price_cents,contracted_currency,external_tenant_id,
  provider_subscription_id,provider_customer_id
) VALUES (
 '40000000-0000-4000-8000-000000000114','30000000-0000-4000-8000-000000000114',
 '10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',
 'past_due','suspended','asaas','recurring',1,'standard',7900,'BRL',
 'tenant-nexus-123','sub_renewal12345','cus_renewal12345'
);
INSERT INTO public.nexus_sales (
 id,product_id,plan_id,sale_status,provider,environment,source,billing_mode,
 billing_cycle_months,checkout_amount_cents,asaas_checkout_id,asaas_subscription_id,
 provider_customer_id,organization_id,registration_number,email,paid_at,provisioned_at
) VALUES (
 '50000000-0000-4000-8000-000000000114','10000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001','provisioned','asaas','production',
 'site-captacao','recurring',1,7900,'123517639363','sub_renewal12345',
 'cus_renewal12345','30000000-0000-4000-8000-000000000114',
 '66666666000199','renewal@example.test',now()-interval '35 days',
 now()-interval '35 days'
);
INSERT INTO public.nexus_crm_asaas_production_events
 (provider_event_id,event_type,resource_id,payload)
 VALUES(
  'asaas:evt_renewal12345678','PAYMENT_RECEIVED','pay_renewal12345',
  jsonb_build_object('event','PAYMENT_RECEIVED',
    'dateCreated',to_char(current_timestamp AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'resource',jsonb_build_object('id','pay_renewal12345',
      'subscription','sub_renewal12345','billingType','PIX',
      'status','RECEIVED','value',79,'dueDate',current_date::text)
  )
 );

DO $$
DECLARE v jsonb; n integer;
BEGIN
 v:=public.record_nexus_crm_asaas_production_renewal(
 '50000000-0000-4000-8000-000000000114',
 '40000000-0000-4000-8000-000000000114',
 'asaas:evt_renewal12345678','pay_renewal12345','cus_other12345',
 7900,'PIX','RECEIVED',current_date,current_date+30);
 IF v->>'reason'<>'access_not_eligible' THEN RAISE EXCEPTION 'Foreign customer passed: %',v;END IF;

 v:=public.record_nexus_crm_asaas_production_renewal(
 '50000000-0000-4000-8000-000000000114',
 '40000000-0000-4000-8000-000000000114',
 'asaas:evt_renewal12345678','pay_renewal12345','cus_renewal12345',
 11900,'PIX','RECEIVED',current_date,current_date+30);
 IF v->>'reason'<>'access_not_eligible' THEN RAISE EXCEPTION 'Price mismatch passed: %',v;END IF;

 v:=public.record_nexus_crm_asaas_production_renewal(
 '50000000-0000-4000-8000-000000000114',
 '40000000-0000-4000-8000-000000000114',
 'asaas:evt_renewal12345678','pay_renewal12345','cus_renewal12345',
 7900,'PIX','RECEIVED',current_date,current_date+30);
 IF v->>'decision'<>'renewal_recorded' THEN RAISE EXCEPTION 'Valid renewal rejected: %',v;END IF;
 SELECT count(*) INTO n FROM public.nexus_payments WHERE provider_payment_id='pay_renewal12345';
 IF n<>1 THEN RAISE EXCEPTION 'Renewal receipt not unique';END IF;
 IF NOT EXISTS(
  SELECT 1 FROM public.organization_product_access a
  WHERE id='40000000-0000-4000-8000-000000000114'
  AND subscription_status='active' AND access_status='active'
  AND renews_at=current_date+30
  AND last_payment_due_date=current_date
  AND provider_state_event_id='asaas:evt_renewal12345678'
 ) THEN RAISE EXCEPTION 'CRM financial state not consistently advanced';END IF;

 v:=public.record_nexus_crm_asaas_production_renewal(
 '50000000-0000-4000-8000-000000000114',
 '40000000-0000-4000-8000-000000000114',
 'asaas:evt_renewal12345678','pay_renewal12345','cus_renewal12345',
 7900,'PIX','RECEIVED',current_date,current_date+30);
 IF v->>'decision'<>'already_recorded' THEN RAISE EXCEPTION 'Payment replay not idempotent: %',v;END IF;
 SELECT count(*) INTO n FROM public.nexus_payments WHERE provider_payment_id='pay_renewal12345';
 IF n<>1 THEN RAISE EXCEPTION 'Replay duplicated receipt';END IF;
 SELECT count(*) INTO n FROM public.organizations WHERE registration_number='66666666000199';
 IF n<>1 THEN RAISE EXCEPTION 'Renewal created another company';END IF;
END $$;
ROLLBACK;
SELECT 'PASS: recurring Asaas renewal is idempotent, same contract, no charge and no new tenant' as result;
