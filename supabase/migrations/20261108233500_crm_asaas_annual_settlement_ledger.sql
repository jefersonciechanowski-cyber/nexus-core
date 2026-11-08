-- CRM Black Friday annual sale: independently verified Asaas DETACHED payment.
-- No public REST policies. Only the backend service role may call the RPCs.
CREATE TABLE IF NOT EXISTS public.nexus_crm_asaas_production_annual_settlements (
  sale_id uuid PRIMARY KEY REFERENCES public.nexus_sales(id) ON DELETE RESTRICT,
  provider_payment_id text UNIQUE NOT NULL CHECK (provider_payment_id ~ '^pay_[A-Za-z0-9_-]{5,120}$'),
  provider_event_id text UNIQUE NOT NULL REFERENCES public.nexus_crm_asaas_production_events(provider_event_id),
  provider_customer_id text NOT NULL CHECK (provider_customer_id ~ '^cus_[A-Za-z0-9_-]{5,120}$'),
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  billing_type text NOT NULL CHECK (billing_type IN ('PIX','BOLETO')),
  decision text NOT NULL DEFAULT 'provision_ready'
    CHECK (decision IN ('provision_ready','provisioning','provisioned','manual_review')),
  verified_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.nexus_crm_asaas_production_annual_settlements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.nexus_crm_asaas_production_annual_settlements FROM PUBLIC,anon,authenticated;
GRANT ALL ON TABLE public.nexus_crm_asaas_production_annual_settlements TO service_role;

CREATE OR REPLACE FUNCTION public.reserve_nexus_crm_asaas_production_annual_settlement(
 p_sale_id uuid, p_provider_event_id text, p_payment_id text,
 p_customer_id text, p_amount_cents bigint, p_billing_type text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_sale public.nexus_sales%ROWTYPE;
        v_event public.nexus_crm_asaas_production_events%ROWTYPE;
        v_existing public.nexus_crm_asaas_production_annual_settlements%ROWTYPE;
BEGIN
  IF p_sale_id IS NULL OR p_payment_id !~ '^pay_[A-Za-z0-9_-]{5,120}$'
    OR p_customer_id !~ '^cus_[A-Za-z0-9_-]{5,120}$'
    OR p_provider_event_id !~ '^asaas:evt_[A-Za-z0-9_&.-]{6,150}$'
    OR p_amount_cents <= 0 OR p_billing_type NOT IN ('PIX','BOLETO') THEN
    RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','invalid_verified_arguments');
  END IF;
  SELECT * INTO v_sale FROM public.nexus_sales WHERE id=p_sale_id FOR UPDATE;
  IF NOT FOUND OR v_sale.provider <> 'asaas' OR v_sale.environment <> 'production'
    OR v_sale.source <> 'site-captacao' OR v_sale.billing_mode <> 'prepaid'
    OR v_sale.billing_cycle_months <> 12 OR v_sale.sale_status <> 'checkout_created'
    OR v_sale.paid_at IS NOT NULL OR v_sale.provisioned_at IS NOT NULL
    OR v_sale.organization_id IS NOT NULL OR v_sale.user_id IS NOT NULL
    OR v_sale.asaas_checkout_id IS NULL OR v_sale.asaas_subscription_id IS NOT NULL
    OR v_sale.checkout_amount_cents <> p_amount_cents THEN
    RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','not_new_verified_annual_sale');
  END IF;
  SELECT * INTO v_event FROM public.nexus_crm_asaas_production_events
    WHERE provider_event_id=p_provider_event_id AND environment='production'
      AND event_type IN ('PAYMENT_CONFIRMED','PAYMENT_RECEIVED')
      AND resource_id=p_payment_id AND processing_status='pending';
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','provider_event_not_pending');
  END IF;
  SELECT * INTO v_existing FROM public.nexus_crm_asaas_production_annual_settlements
    WHERE sale_id=p_sale_id OR provider_payment_id=p_payment_id OR provider_event_id=p_provider_event_id;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','verified_annual_payment_already_claimed');
  END IF;
  INSERT INTO public.nexus_crm_asaas_production_annual_settlements
    (sale_id,provider_event_id,provider_payment_id,provider_customer_id,amount_cents,billing_type)
    VALUES (p_sale_id,p_provider_event_id,p_payment_id,p_customer_id,p_amount_cents,p_billing_type)
    ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','concurrent_payment_claim');
  END IF;
  UPDATE public.nexus_sales SET sale_status='paid',paid_at=pg_catalog.now(),
    provider_customer_id=p_customer_id,asaas_customer_id=p_customer_id,updated_at=pg_catalog.now()
  WHERE id=p_sale_id AND sale_status='checkout_created';
  IF NOT FOUND THEN RAISE EXCEPTION 'annual_sale_changed_after_claim'; END IF;
  RETURN pg_catalog.jsonb_build_object('decision','provision_ready','saleId',p_sale_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.begin_nexus_crm_asaas_production_annual_provisioning(
 p_sale_id uuid, p_payment_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_claim public.nexus_crm_asaas_production_annual_settlements%ROWTYPE;
        v_sale public.nexus_sales%ROWTYPE;
BEGIN
  SELECT * INTO v_claim FROM public.nexus_crm_asaas_production_annual_settlements
    WHERE sale_id=p_sale_id AND provider_payment_id=p_payment_id FOR UPDATE;
  IF NOT FOUND OR v_claim.decision <> 'provision_ready' THEN
    RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','annual_lease_not_available');
  END IF;
  SELECT * INTO v_sale FROM public.nexus_sales WHERE id=p_sale_id
    AND provider='asaas' AND environment='production' AND billing_mode='prepaid'
    AND billing_cycle_months=12 AND sale_status='paid' AND paid_at IS NOT NULL
    AND asaas_subscription_id IS NULL FOR UPDATE;
  IF NOT FOUND OR v_sale.organization_id IS NOT NULL OR v_sale.user_id IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','annual_identity_conflict');
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE registration_number=v_sale.registration_number)
    OR EXISTS (SELECT 1 FROM auth.users WHERE pg_catalog.lower(email)=pg_catalog.lower(v_sale.email)) THEN
    RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','customer_already_exists');
  END IF;
  UPDATE public.nexus_crm_asaas_production_annual_settlements
    SET decision='provisioning',updated_at=pg_catalog.now() WHERE sale_id=p_sale_id AND decision='provision_ready';
  IF NOT FOUND THEN RAISE EXCEPTION 'annual_lease_lost'; END IF;
  RETURN pg_catalog.jsonb_build_object('decision','acquired','saleId',p_sale_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.complete_nexus_crm_asaas_production_annual_provisioning(
 p_sale_id uuid, p_payment_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_claim public.nexus_crm_asaas_production_annual_settlements%ROWTYPE;
        v_sale public.nexus_sales%ROWTYPE;
        v_access public.organization_product_access%ROWTYPE;
BEGIN
  SELECT * INTO v_claim FROM public.nexus_crm_asaas_production_annual_settlements
    WHERE sale_id=p_sale_id AND provider_payment_id=p_payment_id FOR UPDATE;
  IF NOT FOUND OR v_claim.decision <> 'provisioning' THEN
    RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','annual_lease_not_acquired');
  END IF;
  SELECT * INTO v_sale FROM public.nexus_sales
    WHERE id=p_sale_id AND provider='asaas' AND environment='production'
      AND billing_mode='prepaid' AND billing_cycle_months=12
      AND sale_status='provisioned' AND provisioned_at IS NOT NULL AND organization_id IS NOT NULL
      AND user_id IS NOT NULL AND asaas_subscription_id IS NULL;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','annual_sale_incomplete');
  END IF;
  SELECT * INTO v_access FROM public.organization_product_access
    WHERE organization_id=v_sale.organization_id AND product_id=v_sale.product_id
      AND billing_provider='asaas' AND billing_mode='prepaid'
      AND billing_cycle_months=12 AND subscription_status='active' AND access_status='active'
      AND provider_subscription_id IS NULL AND external_tenant_id IS NOT NULL
      AND contracted_price_cents=v_claim.amount_cents;
  IF NOT FOUND OR v_access.renews_at IS NULL THEN
    RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','annual_tenant_incomplete');
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.nexus_payments p
    WHERE p.provider='asaas' AND p.provider_payment_id=p_payment_id
      AND p.organization_id=v_sale.organization_id AND p.access_id=v_access.id
      AND p.provider_subscription_id IS NULL AND p.amount_cents=v_claim.amount_cents) THEN
    RETURN pg_catalog.jsonb_build_object('decision','manual_review','reason','annual_receipt_missing');
  END IF;
  UPDATE public.nexus_crm_asaas_production_annual_settlements
    SET decision='provisioned',updated_at=pg_catalog.now()
    WHERE sale_id=p_sale_id AND decision='provisioning';
  IF NOT FOUND THEN RAISE EXCEPTION 'annual_completion_lost'; END IF;
  RETURN pg_catalog.jsonb_build_object('decision','completed','saleId',p_sale_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.reserve_nexus_crm_asaas_production_annual_settlement(uuid,text,text,text,bigint,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.begin_nexus_crm_asaas_production_annual_provisioning(uuid,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.complete_nexus_crm_asaas_production_annual_provisioning(uuid,text)
  FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_nexus_crm_asaas_production_annual_settlement(uuid,text,text,text,bigint,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_nexus_crm_asaas_production_annual_provisioning(uuid,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_nexus_crm_asaas_production_annual_provisioning(uuid,text)
  TO service_role;
