-- Central disaster-recovery functional acceptance: OFFLINE RESTORED COPY ONLY.
-- Must NEVER run in production. No provider calls, notifications, charges, DML or DDL.
-- Read-only check of payment/contract tenant linkage, followed by a real
-- restored org-admin's JWT-claims/RLS visibility probe. User IDs stay private.

BEGIN TRANSACTION READ ONLY;
DO $functional_billing$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.nexus_payments p
    LEFT JOIN public.organizations o ON o.id = p.organization_id
    WHERE o.id IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.nexus_payment_checkouts c
    LEFT JOIN public.organizations o ON o.id = c.organization_id
    WHERE o.id IS NULL
  ) THEN
    RAISE EXCEPTION 'FAIL: restored billing has orphaned organization references';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.nexus_payments p
    JOIN public.organization_product_access a ON a.id = p.access_id
    WHERE a.organization_id <> p.organization_id
  ) OR EXISTS (
    SELECT 1 FROM public.nexus_payment_checkouts c
    JOIN public.organization_product_access a ON a.id = c.access_id
    WHERE a.organization_id <> c.organization_id
  ) OR EXISTS (
    SELECT 1 FROM public.nexus_payments p
    JOIN public.nexus_payment_checkouts c ON c.id = p.checkout_id
    WHERE c.organization_id <> p.organization_id
  ) THEN
    RAISE EXCEPTION 'FAIL: restored billing cross-organization link detected';
  END IF;
END
$functional_billing$;
ROLLBACK;

-- Select the actual restored organization's account in a private DB session.
-- This is read-only and emits no IDs in GitHub Actions logs.
BEGIN TRANSACTION READ ONLY;
DO $prepare_claims$
DECLARE
  v_user_id uuid;
  v_org_id uuid;
BEGIN
  SELECT m.user_id, m.organization_id INTO v_user_id, v_org_id
  FROM public.organization_memberships m
  JOIN auth.users u ON u.id = m.user_id
  WHERE m.active = true AND m.role::text = 'org_admin'
  ORDER BY m.user_id, m.organization_id
  LIMIT 1;
  IF v_user_id IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'FAIL: restored dataset lacks an active organization administrator for RLS testing';
  END IF;
  PERFORM set_config('dr.expected_org', v_org_id::text, true);
  PERFORM set_config('request.jwt.claim.sub', v_user_id::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user_id, 'role', 'authenticated', 'aal', 'aal1')::text, true);
END
$prepare_claims$;

-- The test must use authenticated privileges, not the restore superuser.
SET LOCAL ROLE authenticated;
DO $verify_org_rls$
DECLARE
  expected_org uuid := current_setting('dr.expected_org', true)::uuid;
  visible_own bigint;
  visible_foreign bigint;
  visible_memberships bigint;
BEGIN
  SELECT count(*) INTO visible_own FROM public.organizations WHERE id = expected_org;
  SELECT count(*) INTO visible_foreign FROM public.organizations WHERE id <> expected_org;
  SELECT count(*) INTO visible_memberships
    FROM public.organization_memberships
    WHERE organization_id = expected_org AND user_id = auth.uid() AND active = true;

  IF visible_own <> 1 OR visible_foreign <> 0 OR visible_memberships <> 1 THEN
    RAISE EXCEPTION 'FAIL: restored organization administrator RLS authorizes incorrect scope';
  END IF;
END
$verify_org_rls$;
ROLLBACK;
