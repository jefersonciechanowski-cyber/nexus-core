-- SST storage security hotfix (already applied to Nexus Central production).
-- PostgreSQL OR-combines PERMISSIVE SELECT policies. The former
-- "sst employee folders restricted select" returned TRUE for every
-- non-employee path, irrespective of organization, and for every future
-- bucket. This defeats the org-scoped SELECT policy and can leak files.
--
-- The tenant predicate and employee role predicate MUST be within ONE
-- SELECT policy; do not re-create the permissive employee SELECT policy.
-- Preserves all existing objects, inserts, updates, deletes and CRM data.

DROP POLICY IF EXISTS "sst employee folders restricted select" ON storage.objects;

ALTER POLICY "sst documents tenant select" ON storage.objects
  USING (
    bucket_id = 'sst-documents'
    AND (
      (storage.foldername(name))[1] = (SELECT public.current_org_id())::text
      OR (SELECT public.is_nexus_admin_aal2())
    )
    AND (
      COALESCE((storage.foldername(name))[2], '') <> 'employees'
      OR (SELECT public.is_nexus_admin_aal2())
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = (SELECT auth.uid())
          AND p.active
          AND p.role IN ('org_admin','sst_manager','sst_technician','hr')
      )
    )
  );

DO $verify$
DECLARE v_count integer; v_expression text;
BEGIN
 SELECT COUNT(*) INTO v_count FROM pg_catalog.pg_policies
 WHERE schemaname='storage' AND tablename='objects'
   AND cmd='SELECT' AND roles::text LIKE '%authenticated%';
 IF v_count<>1 THEN
   RAISE EXCEPTION 'SST storage must have exactly one authenticated SELECT policy';
 END IF;
 SELECT qual INTO v_expression FROM pg_catalog.pg_policies
 WHERE schemaname='storage' AND tablename='objects'
   AND policyname='sst documents tenant select';
 IF v_expression IS NULL
   OR v_expression NOT LIKE '%current_org_id%'
   OR v_expression NOT LIKE '%employees%'
   OR v_expression NOT LIKE '%sst-documents%'
   OR v_expression NOT LIKE '%sst_manager%'
 THEN RAISE EXCEPTION 'SST storage tenant/employee checks missing'; END IF;
 IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname='storage' AND tablename='objects'
      AND policyname='sst employee folders restricted select')
 THEN RAISE EXCEPTION 'Overpermissive SST storage policy remains'; END IF;
END;
$verify$;
