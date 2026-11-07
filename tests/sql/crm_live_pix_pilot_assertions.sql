-- Run only after ephemeral PG17 fixture + private pilot migration. No production DB.
DO $$
DECLARE
  secured boolean;
  caught boolean := false;
BEGIN
  SELECT c.relrowsecurity INTO secured FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='nexus_crm_live_pix_pilot';
  IF secured IS DISTINCT FROM true THEN RAISE EXCEPTION 'pilot RLS required'; END IF;
  IF has_table_privilege('anon','public.nexus_crm_live_pix_pilot','SELECT')
    OR has_table_privilege('authenticated','public.nexus_crm_live_pix_pilot','SELECT')
    OR has_table_privilege('authenticated','public.nexus_crm_live_pix_pilot','INSERT') THEN
    RAISE EXCEPTION 'browser access forbidden';
  END IF;
  IF NOT has_table_privilege('service_role','public.nexus_crm_live_pix_pilot','INSERT') THEN
    RAISE EXCEPTION 'server role missing';
  END IF;
END $$;

BEGIN;
INSERT INTO public.nexus_crm_live_pix_pilot(
  id,external_reference,company_name,responsible_name,email,cpf,plan_id,status
) VALUES (
  '60000000-0000-4000-8000-000000000001',
  'nexus-crm-live-pix-r10-60000000-0000-4000-8000-000000000001',
  'Empresa Piloto Isolada','Pessoa Titular','titular+piloto@example.test',
  '98765432100','20000000-0000-4000-8000-000000000001','prepared'
);
DO $$
DECLARE caught boolean := false;
BEGIN
  BEGIN
    INSERT INTO public.nexus_crm_live_pix_pilot(
      id,external_reference,company_name,responsible_name,email,cpf,plan_id
    ) VALUES (
      '60000000-0000-4000-8000-000000000002',
      'nexus-crm-live-pix-r10-60000000-0000-4000-8000-000000000002',
      'Outra Empresa','Outra Pessoa','outra@example.test',
      '98765432100','20000000-0000-4000-8000-000000000001'
    );
  EXCEPTION WHEN unique_violation THEN caught := true;
  END;
  IF NOT caught THEN RAISE EXCEPTION 'second independent charge slot was not blocked'; END IF;
  caught := false;
  BEGIN
    UPDATE public.nexus_crm_live_pix_pilot SET amount_cents=1001 WHERE slot=1;
  EXCEPTION WHEN check_violation THEN caught := true;
  END;
  IF NOT caught THEN RAISE EXCEPTION 'amount R$10 invariant not enforced'; END IF;
  IF (SELECT COUNT(*) FROM public.nexus_crm_live_pix_pilot) <> 1 THEN
    RAISE EXCEPTION 'unexpected extra pilot record';
  END IF;
END $$;
ROLLBACK;
