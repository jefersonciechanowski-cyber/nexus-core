-- REVIEW-ONLY / NOT APPLIED to Supabase production (26 Oct 2026).
-- PostgreSQL contract proof for existing Asaas CRM recurring accounts ONLY.
-- A private worker must first READ current Asaas API state independently,
-- validate customer/payment/subscription/link/amount, then call this service-
-- role-only RPC. Passing p_verified_status without provider verification
-- would defeat this safety boundary. Never call from a public webhook.
-- No automatic grace policy: PAYMENT_OVERDUE stays manual_review.
CREATE OR REPLACE FUNCTION public.apply_nexus_crm_asaas_lifecycle(
  p_access_id uuid,
  p_provider_event_id text,
  p_verified_status text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_access public.organization_product_access%rowtype;
  v_event public.nexus_payment_webhook_events%rowtype;
  v_sale public.nexus_sales%rowtype;
  v_payment public.nexus_payments%rowtype;
  v_state text;
  v_access_state text;
  v_payment_id text;
  v_resource_id text;
BEGIN
  IF p_access_id IS NULL OR p_provider_event_id !~ '^asaas:evt_[A-Za-z0-9_&.-]{6,150}$'
    OR p_verified_status NOT IN ('RECEIVED','CONFIRMED','REFUNDED','INACTIVE','DELETED') THEN
    RETURN pg_catalog.jsonb_build_object('applied',false,'reason','invalid_input');
  END IF;
  SELECT * INTO v_access FROM public.organization_product_access
  WHERE id=p_access_id FOR UPDATE;
  IF NOT FOUND OR v_access.billing_provider IS DISTINCT FROM 'asaas'
    OR v_access.billing_mode IS DISTINCT FROM 'recurring'
    OR v_access.commercial_condition IS DISTINCT FROM 'standard'
    OR v_access.provider_subscription_id IS NULL
    OR v_access.external_tenant_id IS NULL
    OR NOT EXISTS (SELECT 1 FROM public.nexus_products p
      WHERE p.id=v_access.product_id AND p.code='crm') THEN
    RETURN pg_catalog.jsonb_build_object('applied',false,'reason','not_eligible');
  END IF;
  SELECT * INTO v_sale FROM public.nexus_sales
  WHERE organization_id=v_access.organization_id AND product_id=v_access.product_id
    AND provider='asaas' AND environment='sandbox'
    AND asaas_subscription_id=v_access.provider_subscription_id
    AND sale_status='provisioned'
  ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND OR v_sale.billing_cycle_months IS DISTINCT FROM 1
    OR v_sale.billing_mode IS DISTINCT FROM 'recurring' THEN
    RETURN pg_catalog.jsonb_build_object('applied',false,'reason','sale_not_linked');
  END IF;
  SELECT * INTO v_event FROM public.nexus_payment_webhook_events
  WHERE provider_event_id=p_provider_event_id AND provider='asaas';
  IF NOT FOUND OR v_event.event_type IS DISTINCT FROM (v_event.payload->>'event') THEN
    RETURN pg_catalog.jsonb_build_object('applied',false,'reason','event_not_authenticated');
  END IF;
  IF v_access.provider_state_event_id IS NOT DISTINCT FROM p_provider_event_id THEN
    RETURN pg_catalog.jsonb_build_object('applied',false,'reason','duplicate');
  END IF;
  IF v_access.provider_state_event_created_at IS NOT NULL
    AND v_event.created_at <= v_access.provider_state_event_created_at THEN
    RETURN pg_catalog.jsonb_build_object('applied',false,'reason','stale_event');
  END IF;
  IF v_event.event_type='PAYMENT_OVERDUE' THEN
    RETURN pg_catalog.jsonb_build_object('applied',false,'reason','grace_policy_requires_review');
  END IF;
  IF v_event.event_type NOT IN ('PAYMENT_RECEIVED','PAYMENT_CONFIRMED','PAYMENT_REFUNDED',
                                'SUBSCRIPTION_INACTIVATED','SUBSCRIPTION_DELETED') THEN
    RETURN pg_catalog.jsonb_build_object('applied',false,'reason','unhandled_event');
  END IF;

  v_resource_id := v_event.payload#>>'{resource,id}';
  IF v_event.event_type LIKE 'PAYMENT_%' THEN
    v_payment_id:=v_resource_id;
    IF v_payment_id !~ '^pay_[A-Za-z0-9_-]{5,120}$'
      OR v_event.payload#>>'{resource,subscription}' IS DISTINCT FROM v_access.provider_subscription_id THEN
      RETURN pg_catalog.jsonb_build_object('applied',false,'reason','unlinked_invoice');
    END IF;
    SELECT * INTO v_payment FROM public.nexus_payments
    WHERE provider='asaas' AND provider_payment_id=v_payment_id
      AND access_id=p_access_id AND organization_id=v_access.organization_id
      AND provider_subscription_id=v_access.provider_subscription_id;
    IF NOT FOUND OR v_payment.amount_cents IS DISTINCT FROM v_access.contracted_price_cents THEN
      RETURN pg_catalog.jsonb_build_object('applied',false,'reason','unverified_payment_ownership_or_amount');
    END IF;
  ELSE
    IF v_resource_id IS DISTINCT FROM v_access.provider_subscription_id THEN
      RETURN pg_catalog.jsonb_build_object('applied',false,'reason','wrong_subscription');
    END IF;
  END IF;

  CASE v_event.event_type
    WHEN 'PAYMENT_RECEIVED' THEN
      IF p_verified_status NOT IN ('RECEIVED','CONFIRMED') THEN
        RETURN pg_catalog.jsonb_build_object('applied',false,'reason','payment_not_current');
      END IF;
      v_state:='active';v_access_state:='active';
    WHEN 'PAYMENT_CONFIRMED' THEN
      IF p_verified_status NOT IN ('RECEIVED','CONFIRMED') THEN
        RETURN pg_catalog.jsonb_build_object('applied',false,'reason','payment_not_current');
      END IF;
      v_state:='active';v_access_state:='active';
    WHEN 'PAYMENT_REFUNDED' THEN
      IF p_verified_status <> 'REFUNDED' THEN
        RETURN pg_catalog.jsonb_build_object('applied',false,'reason','refund_not_confirmed');
      END IF;
      v_state:='past_due';v_access_state:='suspended';
    WHEN 'SUBSCRIPTION_INACTIVATED' THEN
      IF p_verified_status <> 'INACTIVE' THEN
        RETURN pg_catalog.jsonb_build_object('applied',false,'reason','subscription_not_inactive');
      END IF;
      v_state:='past_due';v_access_state:='suspended';
    WHEN 'SUBSCRIPTION_DELETED' THEN
      IF p_verified_status <> 'DELETED' THEN
        RETURN pg_catalog.jsonb_build_object('applied',false,'reason','deletion_not_verified');
      END IF;
      v_state:='cancelled';v_access_state:='suspended';
  END CASE;

  -- Cancellation is terminal. A late payment must not reopen the old tenant.
  IF v_access.subscription_status='cancelled' AND v_state<>'cancelled' THEN
    RETURN pg_catalog.jsonb_build_object('applied',false,'reason','terminal_cancelled');
  END IF;
  UPDATE public.organization_product_access
  SET subscription_status=v_state,access_status=v_access_state,
    last_payment_status=v_event.event_type,
    provider_state_event_id=p_provider_event_id,
    provider_state_event_created_at=v_event.created_at,
    provider_state_event_type=v_event.event_type,
    updated_at=pg_catalog.now()
  WHERE id=p_access_id;
  -- CRM tenant data is never deleted. A privileged worker must deliver
  -- this updated entitlement via the existing signed CRM outbox mechanism.
  RETURN pg_catalog.jsonb_build_object('applied',true,'reason','state_updated',
    'subscription_status',v_state,'access_status',v_access_state);
END; $$;
REVOKE ALL ON FUNCTION public.apply_nexus_crm_asaas_lifecycle(uuid,text,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_nexus_crm_asaas_lifecycle(uuid,text,text) TO service_role;
