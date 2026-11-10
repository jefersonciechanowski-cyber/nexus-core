-- Run ONLY in the disposable checkout_identity_ci database, never production.
\set ON_ERROR_STOP on
CREATE TABLE public.nexus_sales (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 registration_number text,email text,environment text,source text,
 provider text,external_reference text UNIQUE,sale_status text
);
-- Reproduce the former race: differing references bypass the old uniqueness.
INSERT INTO public.nexus_sales
(registration_number,email,environment,source,provider,external_reference,sale_status)
VALUES ('doc-a','owner@example.test','production','site-captacao','asaas','crm-annual-pix','lead'),
       ('doc-a','owner@example.test','production','site-captacao','asaas','crm-annual-boleto','lead');
DO $$ BEGIN
 IF (SELECT count(*) FROM public.nexus_sales)<>2 THEN RAISE EXCEPTION 'race not reproduced'; END IF;
END $$;
TRUNCATE public.nexus_sales;
\ir ../../supabase/migrations/20261110171057_crm_public_annual_monthly_identity_lock.sql
INSERT INTO public.nexus_sales
(registration_number,email,environment,source,provider,external_reference,sale_status)
VALUES ('doc-a','owner@example.test','production','site-captacao','asaas','crm-annual-pix','lead');
DO $$
DECLARE blocked integer:=0; s text;
BEGIN
 FOREACH s IN ARRAY ARRAY['lead','checkout_created','paid','provisioned','manual_review'] LOOP
  UPDATE public.nexus_sales SET sale_status=s WHERE registration_number='doc-a';
  BEGIN
   INSERT INTO public.nexus_sales(registration_number,email,environment,source,provider,external_reference,sale_status)
   VALUES ('doc-a','other@example.test','production','site-captacao','asaas','crm-annual-other-method-'||s,'lead');
  EXCEPTION WHEN unique_violation THEN blocked:=blocked+1; END;
  BEGIN
   INSERT INTO public.nexus_sales(registration_number,email,environment,source,provider,external_reference,sale_status)
   VALUES ('doc-b','OWNER@example.test','production','site-captacao','stripe','crm-monthly-other-provider-'||s,'lead');
  EXCEPTION WHEN unique_violation THEN blocked:=blocked+1; END;
 END LOOP;
 IF blocked<>10 THEN RAISE EXCEPTION 'identity duplicate accepted: blocked % of 10',blocked; END IF;
END $$;
-- Different environments and non-checkout leads remain isolated and usable.
INSERT INTO public.nexus_sales(registration_number,email,environment,source,provider,external_reference,sale_status)
VALUES ('doc-a','owner@example.test','sandbox','site-captacao','asaas','crm-sandbox','lead'),
 ('doc-a','owner@example.test','production','commercial','asaas','crm-assisted','lead'),
 ('doc-c','different@example.test','production','site-captacao','asaas','crm-unrelated','lead');
SELECT 'annual/monthly identity locks: ten duplicate attempts denied' AS result;
