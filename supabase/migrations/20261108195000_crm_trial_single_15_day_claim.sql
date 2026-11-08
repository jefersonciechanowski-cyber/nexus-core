-- Nexus CRM: one 15-day trial per CPF/CNPJ (and email), indefinitely.
-- Existing 30-day historic claims are preserved; this blocks NEW 30-day claims.
-- Uniqueness of document_fingerprint and email_fingerprint already exists
-- in public.nexus_crm_trial_claims and is unaffected.
CREATE OR REPLACE FUNCTION public.reserve_nexus_crm_trial(
  p_id uuid,
  p_email_fingerprint text,
  p_document_fingerprint text,
  p_trial_days integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  IF p_id IS NULL OR p_trial_days <> 15
    OR p_email_fingerprint !~ '^[0-9a-f]{64}$'
    OR p_document_fingerprint !~ '^[0-9a-f]{64}$'
  THEN RETURN false; END IF;

  INSERT INTO public.nexus_crm_trial_claims(
    id,email_fingerprint,document_fingerprint,trial_days
  ) VALUES (p_id,p_email_fingerprint,p_document_fingerprint,p_trial_days)
  ON CONFLICT DO NOTHING;

  RETURN FOUND;
END;
$function$;

-- Only backend workers can reserve; never expose this SECURITY DEFINER to clients.
REVOKE ALL ON FUNCTION public.reserve_nexus_crm_trial(uuid,text,text,integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_nexus_crm_trial(uuid,text,text,integer)
  TO service_role;
