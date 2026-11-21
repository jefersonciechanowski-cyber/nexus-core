-- Synthetic-only fixture: no production data or private identifiers.
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE supabase_auth_admin NOLOGIN;
CREATE ROLE supabase_storage_admin NOLOGIN;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
ALTER SCHEMA auth OWNER TO supabase_auth_admin;
ALTER SCHEMA storage OWNER TO supabase_storage_admin;
CREATE TABLE auth.users (
 id uuid PRIMARY KEY,
 email text
);
ALTER TABLE auth.users OWNER TO supabase_auth_admin;
CREATE TABLE storage.synthetic_object (id uuid PRIMARY KEY);
ALTER TABLE storage.synthetic_object OWNER TO supabase_storage_admin;
CREATE TABLE public.organizations (
 id uuid PRIMARY KEY,
 status text NOT NULL
);
CREATE TABLE public.profiles (
 id uuid PRIMARY KEY REFERENCES auth.users(id),
 organization_id uuid REFERENCES public.organizations(id),
 role text NOT NULL,
 active boolean NOT NULL
);
CREATE TABLE public.organization_memberships (
 organization_id uuid NOT NULL REFERENCES public.organizations(id),
 user_id uuid NOT NULL REFERENCES auth.users(id),
 role text NOT NULL,
 active boolean NOT NULL,
 PRIMARY KEY (organization_id,user_id)
);
CREATE TABLE public.nexus_plans (
 id uuid PRIMARY KEY,
 code text NOT NULL
);
CREATE TABLE public.nexus_accounts (
 id uuid PRIMARY KEY,
 status text NOT NULL,
 billing_organization_id uuid NOT NULL REFERENCES public.organizations(id),
 plan_id uuid NOT NULL REFERENCES public.nexus_plans(id)
);
CREATE TABLE public.nexus_account_organizations (
 account_id uuid REFERENCES public.nexus_accounts(id),
 organization_id uuid REFERENCES public.organizations(id),
 active boolean NOT NULL,
 PRIMARY KEY (account_id,organization_id)
);
CREATE TABLE public.nexus_account_users (
 account_id uuid NOT NULL REFERENCES public.nexus_accounts(id),
 user_id uuid NOT NULL REFERENCES auth.users(id),
 active boolean NOT NULL,
 PRIMARY KEY (account_id,user_id)
);
CREATE TABLE public.organization_product_access (
 id uuid PRIMARY KEY,
 organization_id uuid REFERENCES public.organizations(id),
 access_status text NOT NULL,
 subscription_status text NOT NULL
);
CREATE TABLE public.nexus_payment_checkouts (
 id uuid PRIMARY KEY,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.nexus_payments (
 id uuid PRIMARY KEY,
 access_id uuid REFERENCES public.organization_product_access(id),
 status text NOT NULL
);
INSERT INTO auth.users(id,email) VALUES
('00000000-0000-0000-0000-000000000011','qa-a@example.invalid'),
('00000000-0000-0000-0000-000000000012','qa-b@example.invalid');
INSERT INTO public.organizations(id,status) VALUES
('00000000-0000-0000-0000-000000000021','active'),
('00000000-0000-0000-0000-000000000022','archived');
INSERT INTO public.profiles(id,organization_id,role,active) VALUES
('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000021','nexus_admin',true),
('00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000022','org_admin',false);
INSERT INTO public.organization_memberships(organization_id,user_id,role,active) VALUES
('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000011','nexus_admin',true),
('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000012','org_admin',false);
INSERT INTO public.nexus_plans(id,code) VALUES
('00000000-0000-0000-0000-000000000031','start'),
('00000000-0000-0000-0000-000000000032','gestao');
INSERT INTO public.nexus_accounts(id,status,billing_organization_id,plan_id) VALUES
('00000000-0000-0000-0000-000000000041','active','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000031'),
('00000000-0000-0000-0000-000000000042','suspended','00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000032');
INSERT INTO public.nexus_account_organizations(account_id,organization_id,active) VALUES
('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000021',true),
('00000000-0000-0000-0000-000000000042','00000000-0000-0000-0000-000000000022',true);
INSERT INTO public.nexus_account_users(account_id,user_id,active) VALUES
('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000011',true),
('00000000-0000-0000-0000-000000000042','00000000-0000-0000-0000-000000000012',false);
INSERT INTO public.organization_product_access(id,organization_id,access_status,subscription_status) VALUES
('00000000-0000-0000-0000-000000000051','00000000-0000-0000-0000-000000000021','active','active'),
('00000000-0000-0000-0000-000000000052','00000000-0000-0000-0000-000000000022','suspended','trial');
INSERT INTO public.nexus_payment_checkouts(id) VALUES
('00000000-0000-0000-0000-000000000061'),
('00000000-0000-0000-0000-000000000062');
INSERT INTO public.nexus_payments(id,access_id,status) VALUES
('00000000-0000-0000-0000-000000000071','00000000-0000-0000-0000-000000000051','CONFIRMED');
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY synthetic_tenant_scope ON public.organizations
  FOR SELECT TO authenticated
  USING (id = nullif(current_setting('request.jwt.claim.organization_id', true), '')::uuid);
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON public.organizations TO authenticated;
-- Privileged function ownership and EXECUTE grants must survive the restore.
CREATE FUNCTION public.synthetic_owner_context()
  RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
  AS $$ SELECT current_user::text $$;
GRANT EXECUTE ON FUNCTION public.synthetic_owner_context() TO authenticated;
