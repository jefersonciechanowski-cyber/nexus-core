-- ONLY ephemeral PostgreSQL CI; no remote payments or customer records.
BEGIN;
INSERT INTO public.nexus_crm_asaas_production_events(provider_event_id,event_type,resource_id,payload)
SELECT 'asaas:evt_upgrade'||n,'PAYMENT_RECEIVED','pay_upgrade'||n,
 jsonb_build_object('event','PAYMENT_RECEIVED','resource',jsonb_build_object(
 'id','pay_upgrade'||n,'paymentLink','plink_upgrade'||n,'subscription','sub_upgrade'||n))
FROM generate_series(21,24) n;
DO $$
DECLARE r jsonb; n integer; sid uuid; aid uuid; tid text; before_orgs bigint;
BEGIN
 IF has_function_privilege('authenticated','public.stage_nexus_crm_trial_upgrade(uuid,text,text,text,text,bigint,text,date,date)','execute')
 OR has_function_privilege('anon','public.confirm_nexus_crm_trial_upgrade(uuid,text)','execute')
 OR has_table_privilege('authenticated','public.nexus_crm_trial_upgrade_receipts','select')
 THEN RAISE EXCEPTION 'Public financial privilege'; END IF;
 SELECT count(*) INTO before_orgs FROM public.organizations;
 FOR n IN 21..22 LOOP
  sid:=('50000000-0000-4000-8000-0000000000'||n)::uuid;
  aid:=('40000000-0000-4000-8000-0000000000'||n)::uuid;
  tid:='60000000-0000-4000-8000-0000000000'||n;
  r:=public.stage_nexus_crm_trial_upgrade(sid,'asaas:evt_upgrade'||n,'pay_upgrade'||n,'sub_upgrade'||n,'cus_upgrade'||n,7900,'PIX',current_date,current_date+30);
  IF r->>'decision' IS DISTINCT FROM 'awaiting_crm' OR r->>'tenantId' IS DISTINCT FROM tid
   OR (SELECT sale_status FROM public.nexus_sales WHERE id=sid)<>'paid'
   OR (SELECT provisioned_at FROM public.nexus_sales WHERE id=sid) IS NOT NULL
  THEN RAISE EXCEPTION 'Upgrade prematurely provisioned: %',r; END IF;
  r:=public.confirm_nexus_crm_trial_upgrade(sid,'pay_upgrade'||n);
  IF r->>'decision' IS DISTINCT FROM 'retry' THEN RAISE EXCEPTION 'Missing CRM ack accepted'; END IF;
  r:=public.stage_nexus_crm_trial_upgrade(sid,'asaas:evt_upgrade'||n,'pay_upgrade'||n,'sub_upgrade'||n,'cus_upgrade'||n,7900,'PIX',current_date,current_date+30);
  IF r->>'decision' IS DISTINCT FROM 'awaiting_crm'
   OR (SELECT count(*) FROM public.nexus_payments WHERE provider_payment_id='pay_upgrade'||n)<>1
  THEN RAISE EXCEPTION 'Replay duplicated receipt'; END IF;
  UPDATE public.organization_product_access SET crm_sync_revision=1,crm_sync_confirmed_revision=1,crm_sync_last_error=NULL WHERE id=aid;
  r:=public.confirm_nexus_crm_trial_upgrade(sid,'pay_upgrade'||n);
  IF r->>'decision' IS DISTINCT FROM 'provisioned'
   OR (SELECT external_tenant_id FROM public.organization_product_access WHERE id=aid)<>tid
   OR (SELECT renews_at FROM public.organization_product_access WHERE id=aid)<>current_date+30
  THEN RAISE EXCEPTION 'Acknowledged conversion failed'; END IF;
  r:=public.record_nexus_crm_asaas_production_renewal(sid,aid,'asaas:evt_upgrade'||n,'pay_upgrade'||n,'cus_upgrade'||n,7900,'PIX','RECEIVED',current_date,current_date+30);
  IF r->>'decision' IS DISTINCT FROM 'already_recorded' THEN RAISE EXCEPTION 'Duplicate initial receipt is not idempotent: %',r; END IF;
 END LOOP;
 -- Wrong amount/event and courtesy preserve access, sale and receipt counts.
 BEGIN
  PERFORM public.stage_nexus_crm_trial_upgrade('50000000-0000-4000-8000-000000000023','asaas:evt_upgrade23','pay_upgrade23','sub_upgrade23','cus_upgrade23',1,'PIX',current_date,current_date+30);
  RAISE EXCEPTION 'Wrong amount accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Wrong amount accepted' THEN RAISE; END IF; END;
 BEGIN
  PERFORM public.stage_nexus_crm_trial_upgrade('50000000-0000-4000-8000-000000000024','asaas:evt_upgrade24','pay_upgrade24','sub_upgrade24','cus_upgrade24',7900,'PIX',current_date,current_date+30);
  RAISE EXCEPTION 'Courtesy accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM='Courtesy accepted' THEN RAISE; END IF; END;
 IF EXISTS(SELECT 1 FROM public.nexus_crm_trial_upgrade_receipts WHERE payment_id IN ('pay_upgrade23','pay_upgrade24'))
  OR (SELECT count(*) FROM public.organizations)<>before_orgs
 THEN RAISE EXCEPTION 'Failed conversion wrote data or duplicated organization'; END IF;
END $$;
ROLLBACK;
