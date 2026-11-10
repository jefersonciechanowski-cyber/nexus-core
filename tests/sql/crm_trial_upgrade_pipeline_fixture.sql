-- Local-only PG17 fixture: no live users, payments or credentials.
ALTER TABLE public.nexus_plans ADD COLUMN IF NOT EXISTS included_user_limit integer NOT NULL DEFAULT 3;
ALTER TABLE public.organization_product_access ADD COLUMN IF NOT EXISTS base_user_limit_override integer;
ALTER TABLE public.organization_product_access ADD COLUMN IF NOT EXISTS plan_name text;

INSERT INTO public.organizations(id,registration_number,email) VALUES
 ('30000000-0000-4000-8000-000000000021','11144477000261','upgradable-pipeline@example.test'),
 ('30000000-0000-4000-8000-000000000022','22244477000261','expired-pipeline@example.test'),
 ('30000000-0000-4000-8000-000000000023','33344477000261','unreceived-pipeline@example.test'),
 ('30000000-0000-4000-8000-000000000024','44444477000261','courtesy-upgrade-pipeline@example.test');

INSERT INTO public.organization_product_access(
 id,organization_id,product_id,plan_id,subscription_status,access_status,
 renews_at,billing_provider,commercial_condition,contracted_price_cents,external_tenant_id,last_payment_status
) VALUES
 ('40000000-0000-4000-8000-000000000021','30000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','trial','active',current_date+4,null,'standard',0,'60000000-0000-4000-8000-000000000021',null),
 ('40000000-0000-4000-8000-000000000022','30000000-0000-4000-8000-000000000022','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','past_due','suspended',current_date-1,null,'standard',0,'60000000-0000-4000-8000-000000000022','trial_expired'),
 ('40000000-0000-4000-8000-000000000023','30000000-0000-4000-8000-000000000023','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','trial','active',current_date+1,null,'standard',0,'60000000-0000-4000-8000-000000000023',null),
 ('40000000-0000-4000-8000-000000000024','30000000-0000-4000-8000-000000000024','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','active','active',current_date+200,null,'courtesy',0,'60000000-0000-4000-8000-000000000024',null);

INSERT INTO public.nexus_crm_trial_claims(
  id,email_fingerprint,document_fingerprint,trial_days,organization_id,access_id,state
) VALUES
 ('70000000-0000-4000-8000-000000000021',repeat('c',60)||'9021',repeat('d',60)||'9021',15,
  '30000000-0000-4000-8000-000000000021','40000000-0000-4000-8000-000000000021','provisioned'),
 ('70000000-0000-4000-8000-000000000022',repeat('e',60)||'9022',repeat('f',60)||'9022',15,
  '30000000-0000-4000-8000-000000000022','40000000-0000-4000-8000-000000000022','provisioned'),
 ('70000000-0000-4000-8000-000000000023',repeat('1',60)||'9023',repeat('2',60)||'9023',15,
  '30000000-0000-4000-8000-000000000023','40000000-0000-4000-8000-000000000023','provisioned');

INSERT INTO public.nexus_sales(
 id,product_id,plan_id,sale_status,provider,environment,source,billing_mode,
 billing_cycle_months,checkout_amount_cents,asaas_checkout_id,asaas_subscription_id,
 provider_subscription_id,provider_customer_id,registration_number,email,organization_id,paid_at
) VALUES
 ('50000000-0000-4000-8000-000000000021','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','paid','asaas','production','crm-trial-upgrade','recurring',1,7900,'plink_upgrade21','sub_upgrade21','sub_upgrade21','cus_upgrade21','11144477000261','upgradable-pipeline@example.test','30000000-0000-4000-8000-000000000021',now()),
 ('50000000-0000-4000-8000-000000000022','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','paid','asaas','production','crm-trial-upgrade','recurring',1,7900,'plink_upgrade22','sub_upgrade22','sub_upgrade22','cus_upgrade22','22244477000261','expired-pipeline@example.test','30000000-0000-4000-8000-000000000022',now()),
 ('50000000-0000-4000-8000-000000000023','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','paid','asaas','production','crm-trial-upgrade','recurring',1,7900,'plink_upgrade23','sub_upgrade23','sub_upgrade23','cus_upgrade23','33344477000261','unreceived-pipeline@example.test','30000000-0000-4000-8000-000000000023',now()),
 ('50000000-0000-4000-8000-000000000024','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','paid','asaas','production','crm-trial-upgrade','recurring',1,7900,'plink_upgrade24','sub_upgrade24','sub_upgrade24','cus_upgrade24','44444477000261','courtesy-upgrade-pipeline@example.test','30000000-0000-4000-8000-000000000024',now());


ALTER TABLE public.nexus_sales ADD COLUMN IF NOT EXISTS asaas_customer_id text;
ALTER TABLE public.nexus_sales ADD COLUMN IF NOT EXISTS last_error text;
ALTER TABLE public.organization_product_access ADD COLUMN IF NOT EXISTS crm_sync_last_error text;
UPDATE public.nexus_sales SET sale_status='checkout_created',paid_at=NULL,provider_customer_id=NULL,provider_subscription_id=NULL,asaas_subscription_id=NULL WHERE source='crm-trial-upgrade' AND id::text LIKE '%00000000002_';

