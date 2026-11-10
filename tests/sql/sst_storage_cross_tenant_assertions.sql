-- Run after the patched migration. The same synthetic org A user must
-- see only its own non-employee documents, not another company or a future bucket.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('app.test_org_id','10000000-0000-4000-8000-000000000001',true);
SELECT pg_catalog.set_config('app.test_user_id','50000000-0000-4000-8000-000000000001',true);
DO $check$
BEGIN
 IF (SELECT count(*) FROM storage.objects) <> 1
 THEN RAISE EXCEPTION 'SST tenant or employee storage SELECT isolation failed'; END IF;
 IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE id='60000000-0000-4000-8000-000000000001')
 THEN RAISE EXCEPTION 'Same-tenant document should be readable'; END IF;
 IF EXISTS (SELECT 1 FROM storage.objects WHERE id='60000000-0000-4000-8000-000000000002')
 THEN RAISE EXCEPTION 'Ordinary employee should not read restricted employee folder'; END IF;
 IF EXISTS (SELECT 1 FROM storage.objects WHERE id='60000000-0000-4000-8000-000000000003')
 THEN RAISE EXCEPTION 'Cross-tenant document readable'; END IF;
 IF EXISTS (SELECT 1 FROM storage.objects WHERE id='60000000-0000-4000-8000-000000000005')
 THEN RAISE EXCEPTION 'Future private bucket readable'; END IF;
END;
$check$;
ROLLBACK;

-- Same-tenant manager can still read employee documents, but not other orgs.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('app.test_org_id','10000000-0000-4000-8000-000000000001',true);
SELECT pg_catalog.set_config('app.test_user_id','50000000-0000-4000-8000-000000000002',true);
DO $check$
BEGIN
 IF (SELECT count(*) FROM storage.objects) <> 2
   OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE id='60000000-0000-4000-8000-000000000002')
 THEN RAISE EXCEPTION 'Authorized same-tenant SST manager cannot read employee documents'; END IF;
END;
$check$;
ROLLBACK;

-- Verified Nexus AAL2 admin can still read cross-tenant SST documents only,
-- never arbitrary buckets that did not exist when this policy was written.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('app.test_org_id','10000000-0000-4000-8000-000000000001',true);
SELECT pg_catalog.set_config('app.test_user_id','50000000-0000-4000-8000-000000000002',true);
SELECT pg_catalog.set_config('app.test_admin_aal2','true',true);
DO $check$
BEGIN
 IF (SELECT count(*) FROM storage.objects) <> 4
 THEN RAISE EXCEPTION 'AAL2 admin lost SST access or gained another private bucket'; END IF;
END;
$check$;
ROLLBACK;
