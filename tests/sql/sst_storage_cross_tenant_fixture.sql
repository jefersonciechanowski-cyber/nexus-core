-- PostgreSQL 17 isolated SST storage RLS test. Synthetic identities only.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE SCHEMA storage;
CREATE TYPE public.app_role AS ENUM
 ('org_admin','sst_manager','sst_technician','hr','employee');
CREATE TABLE public.profiles(id uuid PRIMARY KEY,active boolean,role public.app_role);
GRANT SELECT ON public.profiles TO authenticated;
CREATE TABLE storage.objects(id uuid PRIMARY KEY,bucket_id text NOT NULL,name text NOT NULL);
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT ON storage.objects TO authenticated;
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION storage.foldername(p_name text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path=''
AS $$SELECT pg_catalog.string_to_array(p_name, '/')$$;
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE SET search_path=''
AS $$SELECT NULLIF(pg_catalog.current_setting('app.test_user_id',true),'')::uuid$$;
CREATE FUNCTION public.current_org_id() RETURNS uuid
LANGUAGE sql STABLE SET search_path=''
AS $$SELECT NULLIF(pg_catalog.current_setting('app.test_org_id',true),'')::uuid$$;
CREATE FUNCTION public.is_nexus_admin_aal2() RETURNS boolean
LANGUAGE sql STABLE SET search_path=''
AS $$SELECT COALESCE(NULLIF(pg_catalog.current_setting('app.test_admin_aal2',true),'')::boolean,false)$$;
CREATE POLICY "sst documents tenant select" ON storage.objects FOR SELECT
TO authenticated USING (bucket_id='sst-documents' AND
  ((storage.foldername(name))[1] = public.current_org_id()::text OR public.is_nexus_admin_aal2()));
-- Deliberately reproduce the OLD unsafe OR policy to prove the leak first.
CREATE POLICY "sst employee folders restricted select" ON storage.objects
FOR SELECT TO authenticated USING (
 bucket_id <> 'sst-documents'
 OR COALESCE((storage.foldername(name))[2],'') <> 'employees'
 OR public.is_nexus_admin_aal2()
 OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id=auth.uid() AND p.active
    AND p.role IN ('org_admin','sst_manager','sst_technician','hr')));
INSERT INTO public.profiles(id,active,role) VALUES
 ('50000000-0000-4000-8000-000000000001',true,'employee'),
 ('50000000-0000-4000-8000-000000000002',true,'sst_manager');
INSERT INTO storage.objects (id,bucket_id,name) VALUES
 ('60000000-0000-4000-8000-000000000001','sst-documents','10000000-0000-4000-8000-000000000001/reports/interno.pdf'),
 ('60000000-0000-4000-8000-000000000002','sst-documents','10000000-0000-4000-8000-000000000001/employees/funcionario.pdf'),
 ('60000000-0000-4000-8000-000000000003','sst-documents','20000000-0000-4000-8000-000000000002/reports/outra-empresa.pdf'),
 ('60000000-0000-4000-8000-000000000004','sst-documents','20000000-0000-4000-8000-000000000002/employees/outra-empresa.pdf'),
 ('60000000-0000-4000-8000-000000000005','future-private-bucket','topsecret/interno.pdf');
-- Before: an authenticated user in org A can see org B non-employee documents,
-- even though the tenant SELECT policy is correct, because RLS combines
-- permissive policies with OR.
BEGIN;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('app.test_org_id','10000000-0000-4000-8000-000000000001',true);
SELECT pg_catalog.set_config('app.test_user_id','50000000-0000-4000-8000-000000000001',true);
DO $before$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM storage.objects
   WHERE name LIKE '%outra-empresa.pdf' AND name LIKE '%/reports/%')
 THEN RAISE EXCEPTION 'Test setup did not reproduce the original SST cross-tenant read'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='future-private-bucket')
 THEN RAISE EXCEPTION 'Test setup did not reproduce future-bucket overgrant'; END IF;
END;
$before$;
ROLLBACK;
