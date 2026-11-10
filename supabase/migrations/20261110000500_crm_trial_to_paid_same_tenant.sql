-- Nexus CRM: finalize an independently VERIFIED monthly Asaas payment against
-- the EXISTING fifteen-day trial tenant. This function NEVER calls Asaas,
-- starts a checkout, creates an organization/user, or sends a customer email.
-- It is private to the service-role financial worker and cannot be invoked
-- from anonymous checkout or the customer browser.
--
-- Before invoking, a dedicated worker MUST verify actual RECEIVED payment,
-- customer, recurring subscription and provider checkout using fresh Asaas GETs,
-- insert its immutable linked receipt into nexus_payments, and provide a
-- provenance-verified sale with source='crm-trial-upgrade'. A normal public
-- signup is strictly ineligible.
CREATE OR REPLACE FUNCTION public.complete_nexus_crm_trial_paid_upgrade(
  p_sale_id uuid, p_payment_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
 v_sale public.nexus_sales%ROWTYPE;
 v_access public.organization_product_access%ROWTYPE;
 v_plan public.nexus_plans%ROWTYPE;
 v_org public.organizations%ROWTYPE;
 v_receipt public.nexus_payments%ROWTYPE;
 v_count integer;
BEGIN
 IF p_sale_id IS NULL OR p_payment_id IS NULL
    OR p_payment_id !~ '^pay_[A-Za-z0-9_-]{5,120}$'
 THEN RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','invalid_receipt'); END IF;

 SELECT s.* INTO v_sale FROM public.nexus_sales s
 JOIN public.nexus_products p ON p.id=s.product_id AND p.code='crm' AND p.status='active'
 WHERE s.id=p_sale_id FOR UPDATE OF s;

 IF NOT FOUND OR v_sale.provider<>'asaas' OR v_sale.environment<>'production'
   OR v_sale.source<>'crm-trial-upgrade'
   OR v_sale.billing_mode<>'recurring' OR v_sale.billing_cycle_months<>1
   OR v_sale.organization_id IS NULL OR v_sale.sale_status NOT IN ('paid','provisioned')
   OR v_sale.paid_at IS NULL OR v_sale.asaas_checkout_id IS NULL
   OR v_sale.provider_subscription_id IS NULL
   OR v_sale.provider_customer_id IS NULL
   OR v_sale.provider_customer_id !~ '^cus_[A-Za-z0-9_-]{5,120} '^sub_[A-Za-z0-9_-]{5,120}$'
   OR v_sale.asaas_subscription_id IS DISTINCT FROM v_sale.provider_subscription_id
 THEN RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','not_authenticated_trial_upgrade_sale'); END IF;

 SELECT a.* INTO v_access FROM public.organization_product_access a
 WHERE a.organization_id=v_sale.organization_id AND a.product_id=v_sale.product_id
 FOR UPDATE;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','trial_access_missing'); END IF;

 SELECT p.* INTO v_plan FROM public.nexus_plans p
 WHERE p.id=v_sale.plan_id AND p.product_id=v_sale.product_id
   AND p.status='active' AND p.public_visible IS TRUE AND p.currency='BRL'
   AND p.billing_interval_months=1 AND p.code IN ('start','pro','gestao');
 IF NOT FOUND OR v_plan.price_cents <= 0
   OR v_plan.included_user_limit < 1 OR v_sale.checkout_amount_cents IS DISTINCT FROM v_plan.price_cents
 THEN RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','plan_or_price_changed'); END IF;

 SELECT o.* INTO v_org FROM public.organizations o WHERE o.id=v_access.organization_id;
 IF NOT FOUND OR v_org.registration_number IS DISTINCT FROM v_sale.registration_number
   OR pg_catalog.lower(v_org.email) IS DISTINCT FROM pg_catalog.lower(v_sale.email)
 THEN RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','existing_organization_identity_mismatch'); END IF;

 SELECT pg_catalog.count(*) INTO v_count FROM public.nexus_crm_trial_claims c
 WHERE c.organization_id=v_access.organization_id
   AND c.access_id=v_access.id AND c.state='provisioned' AND c.trial_days=15;
 IF v_count<>1 OR v_access.commercial_condition<>'standard'
   OR v_access.external_tenant_id IS NULL
   OR v_access.external_tenant_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 THEN RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','not_verified_standard_trial'); END IF;

 SELECT pay.* INTO v_receipt FROM public.nexus_payments pay
 WHERE pay.provider_payment_id=p_payment_id AND pay.provider='asaas'
   AND pay.organization_id=v_access.organization_id AND pay.access_id=v_access.id
   AND pay.provider_subscription_id=v_sale.provider_subscription_id
   AND pay.provider_customer_id=v_sale.provider_customer_id
   AND pay.provider_status='RECEIVED' AND pay.received_at IS NOT NULL
   AND pay.currency='BRL' AND pay.billing_type IN ('PIX','BOLETO')
   AND pay.amount_cents=v_plan.price_cents;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','verified_receipt_missing'); END IF;

 -- Idempotent replay is valid ONLY for the exact same paid contract. It can
 -- never silently switch existing provider, plan, amount or CRM tenant.
 IF v_access.subscription_status='active' THEN
   IF v_sale.sale_status='provisioned' AND v_access.access_status='active'
      AND v_access.plan_id=v_plan.id AND v_access.billing_provider='asaas'
      AND v_access.provider_subscription_id=v_sale.provider_subscription_id
      AND v_access.contracted_price_cents=v_plan.price_cents
   THEN RETURN pg_catalog.jsonb_build_object('decision','already_completed',
       'access_id',v_access.id,'organization_id',v_access.organization_id,
       'crm_tenant_id',v_access.external_tenant_id); END IF;
   RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','existing_paid_access_conflict');
 END IF;

 IF v_access.subscription_status NOT IN ('trial','past_due')
   OR v_access.access_status NOT IN ('active','suspended')
   OR (v_access.subscription_status='past_due' AND
       (v_access.access_status<>'suspended' OR v_access.last_payment_status<>'trial_expired'))
   OR v_access.billing_provider IS NOT NULL
   OR v_access.provider_subscription_id IS NOT NULL
   OR v_access.contracted_price_cents<>0
 THEN RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','trial_lifecycle_changed'); END IF;

 -- No new organization, CRM tenant, owner or lead records are ever inserted.
 -- Preserve the original access ID, started_at and external_tenant_id.
 UPDATE public.organization_product_access
 SET plan_id=v_plan.id,plan_name=v_plan.name,
     contracted_price_cents=v_plan.price_cents,contracted_currency='BRL',
     base_user_limit_override=v_plan.included_user_limit,
     billing_mode='recurring',billing_cycle_months=1,
     billing_provider='asaas',provider_customer_id=v_sale.provider_customer_id,
     provider_subscription_id=v_sale.provider_subscription_id,
     access_status='active',subscription_status='active',
     last_payment_status='RECEIVED',last_payment_at=pg_catalog.now(),
     renews_at=(pg_catalog.current_date + INTERVAL '1 month')::date,
     updated_at=pg_catalog.now()
 WHERE id=v_access.id AND subscription_status IN ('trial','past_due')
   AND billing_provider IS NULL AND contracted_price_cents=0;
 IF NOT FOUND THEN RAISE EXCEPTION 'Trial entitlement changed concurrently'; END IF;

 UPDATE public.nexus_sales
 SET sale_status='provisioned',updated_at=pg_catalog.now()
 WHERE id=p_sale_id AND sale_status='paid';
 IF NOT FOUND THEN RAISE EXCEPTION 'Paid upgrade sale changed concurrently'; END IF;

 RETURN pg_catalog.jsonb_build_object('decision','upgraded',
   'access_id',v_access.id,'organization_id',v_access.organization_id,
   'crm_tenant_id',v_access.external_tenant_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_nexus_crm_trial_paid_upgrade(uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_nexus_crm_trial_paid_upgrade(uuid,text)
  TO service_role;

   OR v_sale.provider_subscription_id !~ '^sub_[A-Za-z0-9_-]{5,120}$'
   OR v_sale.asaas_subscription_id IS DISTINCT FROM v_sale.provider_subscription_id
 THEN RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','not_authenticated_trial_upgrade_sale'); END IF;

 SELECT a.* INTO v_access FROM public.organization_product_access a
 WHERE a.organization_id=v_sale.organization_id AND a.product_id=v_sale.product_id
 FOR UPDATE;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','trial_access_missing'); END IF;

 SELECT p.* INTO v_plan FROM public.nexus_plans p
 WHERE p.id=v_sale.plan_id AND p.product_id=v_sale.product_id
   AND p.status='active' AND p.public_visible IS TRUE AND p.currency='BRL'
   AND p.billing_interval_months=1 AND p.code IN ('start','pro','gestao');
 IF NOT FOUND OR v_plan.price_cents <= 0
   OR v_plan.included_user_limit < 1 OR v_sale.checkout_amount_cents IS DISTINCT FROM v_plan.price_cents
 THEN RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','plan_or_price_changed'); END IF;

 SELECT o.* INTO v_org FROM public.organizations o WHERE o.id=v_access.organization_id;
 IF NOT FOUND OR v_org.registration_number IS DISTINCT FROM v_sale.registration_number
   OR pg_catalog.lower(v_org.email) IS DISTINCT FROM pg_catalog.lower(v_sale.email)
 THEN RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','existing_organization_identity_mismatch'); END IF;

 SELECT pg_catalog.count(*) INTO v_count FROM public.nexus_crm_trial_claims c
 WHERE c.organization_id=v_access.organization_id
   AND c.access_id=v_access.id AND c.state='provisioned' AND c.trial_days=15;
 IF v_count<>1 OR v_access.commercial_condition<>'standard'
   OR v_access.external_tenant_id IS NULL
   OR v_access.external_tenant_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
 THEN RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','not_verified_standard_trial'); END IF;

 SELECT pay.* INTO v_receipt FROM public.nexus_payments pay
 WHERE pay.provider_payment_id=p_payment_id AND pay.provider='asaas'
   AND pay.organization_id=v_access.organization_id AND pay.access_id=v_access.id
   AND pay.provider_subscription_id=v_sale.provider_subscription_id
   AND pay.provider_customer_id=v_sale.provider_customer_id
   AND pay.provider_status='RECEIVED' AND pay.received_at IS NOT NULL
   AND pay.currency='BRL' AND pay.billing_type IN ('PIX','BOLETO')
   AND pay.amount_cents=v_plan.price_cents;
 IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','verified_receipt_missing'); END IF;

 -- Idempotent replay is valid ONLY for the exact same paid contract. It can
 -- never silently switch existing provider, plan, amount or CRM tenant.
 IF v_access.subscription_status='active' THEN
   IF v_sale.sale_status='provisioned' AND v_access.access_status='active'
      AND v_access.plan_id=v_plan.id AND v_access.billing_provider='asaas'
      AND v_access.provider_subscription_id=v_sale.provider_subscription_id
      AND v_access.contracted_price_cents=v_plan.price_cents
   THEN RETURN pg_catalog.jsonb_build_object('decision','already_completed',
       'access_id',v_access.id,'organization_id',v_access.organization_id,
       'crm_tenant_id',v_access.external_tenant_id); END IF;
   RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','existing_paid_access_conflict');
 END IF;

 IF v_access.subscription_status NOT IN ('trial','past_due')
   OR v_access.access_status NOT IN ('active','suspended')
   OR (v_access.subscription_status='past_due' AND
       (v_access.access_status<>'suspended' OR v_access.last_payment_status<>'trial_expired'))
   OR v_access.billing_provider IS NOT NULL
   OR v_access.provider_subscription_id IS NOT NULL
   OR v_access.contracted_price_cents<>0
 THEN RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','trial_lifecycle_changed'); END IF;

 -- No new organization, CRM tenant, owner or lead records are ever inserted.
 -- Preserve the original access ID, started_at and external_tenant_id.
 UPDATE public.organization_product_access
 SET plan_id=v_plan.id,plan_name=v_plan.name,
     contracted_price_cents=v_plan.price_cents,contracted_currency='BRL',
     base_user_limit_override=v_plan.included_user_limit,
     billing_mode='recurring',billing_cycle_months=1,
     billing_provider='asaas',provider_customer_id=v_sale.provider_customer_id,
     provider_subscription_id=v_sale.provider_subscription_id,
     access_status='active',subscription_status='active',
     last_payment_status='RECEIVED',last_payment_at=pg_catalog.now(),
     renews_at=(pg_catalog.current_date + INTERVAL '1 month')::date,
     updated_at=pg_catalog.now()
 WHERE id=v_access.id AND subscription_status IN ('trial','past_due')
   AND billing_provider IS NULL AND contracted_price_cents=0;
 IF NOT FOUND THEN RAISE EXCEPTION 'Trial entitlement changed concurrently'; END IF;

 UPDATE public.nexus_sales
 SET sale_status='provisioned',updated_at=pg_catalog.now()
 WHERE id=p_sale_id AND sale_status='paid';
 IF NOT FOUND THEN RAISE EXCEPTION 'Paid upgrade sale changed concurrently'; END IF;

 RETURN pg_catalog.jsonb_build_object('decision','upgraded',
   'access_id',v_access.id,'organization_id',v_access.organization_id,
   'crm_tenant_id',v_access.external_tenant_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.complete_nexus_crm_trial_paid_upgrade(uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.complete_nexus_crm_trial_paid_upgrade(uuid,text)
  TO service_role;
