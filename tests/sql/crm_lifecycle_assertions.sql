-- PostgreSQL 17 integration assertions for an *already provisioned* CRM tenant.
DO $$
DECLARE v jsonb;x integer;
BEGIN
  -- Overdue event alone is not authorization for immediate suspension.
  v:=public.apply_nexus_crm_asaas_lifecycle(
    '40000000-0000-4000-8000-000000000004','asaas:evt_overdue1234','RECEIVED');
  IF v->>'reason'<>'grace_policy_requires_review' THEN RAISE EXCEPTION 'overdue should wait for approved grace policy %',v; END IF;

  -- Spoofing the provider's current status is blocked by input checks here;
  -- independent GET confirmation by the caller remains an external gate.
  v:=public.apply_nexus_crm_asaas_lifecycle(
    '40000000-0000-4000-8000-000000000004','asaas:evt_inactive1234','RECEIVED');
  IF v->>'reason'<>'subscription_not_inactive' THEN RAISE EXCEPTION 'unverified suspension: %',v; END IF;
  v:=public.apply_nexus_crm_asaas_lifecycle(
    '40000000-0000-4000-8000-000000000004','asaas:evt_inactive1234','INACTIVE');
  IF v->>'applied'<>'true' OR v->>'access_status'<>'suspended' THEN RAISE EXCEPTION 'inactive not suspended: %',v; END IF;
  v:=public.apply_nexus_crm_asaas_lifecycle(
    '40000000-0000-4000-8000-000000000004','asaas:evt_inactive1234','INACTIVE');
  IF v->>'reason'<>'duplicate' THEN RAISE EXCEPTION 'event replay changed state: %',v; END IF;

  -- A confirmed payment may restore access after an inactivation.
  v:=public.apply_nexus_crm_asaas_lifecycle(
    '40000000-0000-4000-8000-000000000004','asaas:evt_received1234','RECEIVED');
  IF v->>'access_status'<>'active' THEN RAISE EXCEPTION 'verified recovery did not restore access: %',v; END IF;

  -- A refunded, linked payment suspends but does NOT delete any tenant/user.
  v:=public.apply_nexus_crm_asaas_lifecycle(
    '40000000-0000-4000-8000-000000000004','asaas:evt_refund12345','RECEIVED');
  IF v->>'reason'<>'refund_not_confirmed' THEN RAISE EXCEPTION 'unverified refund suspended access: %',v; END IF;
  v:=public.apply_nexus_crm_asaas_lifecycle(
    '40000000-0000-4000-8000-000000000004','asaas:evt_refund12345','REFUNDED');
  IF v->>'access_status'<>'suspended' THEN RAISE EXCEPTION 'refund not suspended: %',v; END IF;
  v:=public.apply_nexus_crm_asaas_lifecycle(
    '40000000-0000-4000-8000-000000000004','asaas:evt_repaid12345','RECEIVED');
  IF v->>'access_status'<>'active' THEN RAISE EXCEPTION 'verified subsequent payment not applied: %',v; END IF;

  -- Deletion is terminal; a later paid event does not reactivate the plan.
  v:=public.apply_nexus_crm_asaas_lifecycle(
    '40000000-0000-4000-8000-000000000004','asaas:evt_deleted1234','INACTIVE');
  IF v->>'reason'<>'deletion_not_verified' THEN RAISE EXCEPTION 'deletion without provider proof: %',v; END IF;
  v:=public.apply_nexus_crm_asaas_lifecycle(
    '40000000-0000-4000-8000-000000000004','asaas:evt_deleted1234','DELETED');
  IF v->>'subscription_status'<>'cancelled' OR v->>'access_status'<>'suspended' THEN
    RAISE EXCEPTION 'verified cancellation not terminal: %',v;
  END IF;
  v:=public.apply_nexus_crm_asaas_lifecycle(
    '40000000-0000-4000-8000-000000000004','asaas:evt_oldpaid1234','RECEIVED');
  IF v->>'reason'<>'terminal_cancelled' THEN RAISE EXCEPTION 'cancelled account reactivated: %',v; END IF;

  -- Wrong provider, existing courtesy, and payment of another org can't be changed.
  v:=public.apply_nexus_crm_asaas_lifecycle(
    '40000000-0000-4000-8000-000000000002','asaas:evt_deleted1234','DELETED');
  IF v->>'reason'<>'not_eligible' THEN RAISE EXCEPTION 'agency courtesy altered: %',v; END IF;
  v:=public.apply_nexus_crm_asaas_lifecycle(
    '40000000-0000-4000-8000-000000000003','asaas:evt_deleted1234','DELETED');
  IF v->>'reason'<>'not_eligible' THEN RAISE EXCEPTION 'Stripe contract altered: %',v; END IF;
  SELECT count(*) INTO x FROM public.organization_product_access
    WHERE id IN ('40000000-0000-4000-8000-000000000002','40000000-0000-4000-8000-000000000003')
      AND access_status='active';
  IF x<>2 THEN RAISE EXCEPTION 'courtesy/Stripe affected by Asaas lifecycle'; END IF;
  SELECT count(*) INTO x FROM public.organizations;
  IF x<>4 THEN RAISE EXCEPTION 'CRM lifecycle unexpectedly removed client company'; END IF;
END $$;

DO $$
BEGIN
  IF has_function_privilege('anon','public.apply_nexus_crm_asaas_lifecycle(uuid,text,text)','EXECUTE')
    OR has_function_privilege('authenticated','public.apply_nexus_crm_asaas_lifecycle(uuid,text,text)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.apply_nexus_crm_asaas_lifecycle(uuid,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'Unauthorized lifecycle RPC grants';
  END IF;
END $$;
SELECT 'PASS: lifecycle refund/inactive/paid/deleted/terminal + courtesy isolation (PG17)' AS result;
