-- Pending CRM trial self-service requests: private email proof of possession.
-- No public policies, no raw verification tokens, no provisional CRM access.
CREATE TABLE IF NOT EXISTS public.nexus_crm_public_trial_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
 email text NOT NULL,
 company_name text NOT NULL,
 responsible_name text NOT NULL,
 registration_number text NOT NULL,
 registration_type text NOT NULL CHECK (registration_type IN ('CPF','CNPJ')),
 phone text,
 plan_id uuid NOT NULL REFERENCES public.nexus_plans(id) ON DELETE RESTRICT,
 postal_code text,street text,street_number text,address_complement text,
 district text,city text,state text,
 trial_days integer NOT NULL DEFAULT 15 CHECK (trial_days=15),
 state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','activating','provisioned','manual_review','expired')),
 expires_at timestamptz NOT NULL,
 claimed_at timestamptz,
 organization_id uuid REFERENCES public.organizations(id),
 access_id uuid REFERENCES public.organization_product_access(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS nexus_crm_public_trial_requests_expiry_idx
 ON public.nexus_crm_public_trial_requests(state,expires_at);
ALTER TABLE public.nexus_crm_public_trial_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nexus_crm_public_trial_requests FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.nexus_crm_public_trial_requests TO service_role;

CREATE OR REPLACE FUNCTION public.claim_nexus_crm_public_trial_request(
  p_token_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $function$
DECLARE v_id uuid;
BEGIN
 IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$' THEN
   RETURN pg_catalog.jsonb_build_object('decision','denied');
 END IF;
 UPDATE public.nexus_crm_public_trial_requests
   SET state='activating',claimed_at=pg_catalog.now(),updated_at=pg_catalog.now()
   WHERE token_hash=p_token_hash AND state='pending' AND expires_at>pg_catalog.now()
   RETURNING id INTO v_id;
 IF v_id IS NULL THEN RETURN pg_catalog.jsonb_build_object('decision','denied'); END IF;
 RETURN pg_catalog.jsonb_build_object('decision','claimed','id',v_id);
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_nexus_crm_public_trial_request(text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_nexus_crm_public_trial_request(text) TO service_role;
