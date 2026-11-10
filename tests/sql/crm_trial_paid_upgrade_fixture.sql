-- Local-only PG17 fixture: no live users, payments or credentials.
ALTER TABLE public.nexus_plans ADD COLUMN IF NOT EXISTS included_user_limit integer NOT NULL DEFAULT 3;
ALTER TABLE public.organization_product_access ADD COLUMN IF NOT EXISTS base_user_limit_override integer;
ALTER TABLE public.organization_product_access ADD COLUMN IF NOT EXISTS plan_name text;

INSERT INTO public.organizations(id,registration_number,email) VALUES
 ('30000000-0000-4000-8000-000000000011','11144477000161','upgradable@example.test'),
 ('30000000-0000-4000-8000-000000000012','22244477000161','expired@example.test'),
 ('30000000-0000-4000-8000-000000000013','33344477000161','unreceived@example.test'),
 ('30000000-0000-4000-8000-000000000014','44444477000161','courtesy-upgrade@example.test');

INSERT INTO public.organization_product_access(
 id,organization_id,product_id,plan_id,subscription_status,access_status,
 renews_at,billing_provider,commercial_condition,contracted_price_cents,external_tenant_id,last_payment_status
) VALUES
 ('40000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','trial','active',current_date+4,null,'standard',0,'60000000-0000-4000-8000-000000000011',null),
 ('40000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','past_due','suspended',current_date-1,null,'standard',0,'60000000-0000-4000-8000-000000000012','trial_expired'),
 ('40000000-0000-4000-8000-000000000013','30000000-0000-4000-8000-000000000013','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','trial','active',current_date+1,null,'standard',0,'60000000-0000-4000-8000-000000000013',null),
 ('40000000-0000-4000-8000-000000000014','30000000-0000-4000-8000-000000000014','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','active','active',current_date+200,null,'courtesy',0,'60000000-0000-4000-8000-000000000014',null);

INSERT INTO public.nexus_crm_trial_claims(
  id,email_fingerprint,document_fingerprint,trial_days,organization_id,access_id,state
) VALUES
 ('70000000-0000-4000-8000-000000000011',repeat('c',64),repeat('d',64),15,
  '30000000-0000-4000-8000-000000000011','40000000-0000-4000-8000-000000000011','provisioned'),
 ('70000000-0000-4000-8000-000000000012',repeat('e',64),repeat('f',64),15,
  '30000000-0000-4000-8000-000000000012','40000000-0000-4000-8000-000000000012','provisioned'),
 ('70000000-0000-4000-8000-000000000013',repeat('1',64),repeat('2',64),15,
  '30000000-0000-4000-8000-000000000013','40000000-0000-4000-8000-000000000013','provisioned');

INSERT INTO public.nexus_sales(
 id,product_id,plan_id,sale_status,provider,environment,source,billing_mode,
 billing_cycle_months,checkout_amount_cents,asaas_checkout_id,asaas_subscription_id,
 provider_subscription_id,provider_customer_id,registration_number,email,organization_id,paid_at
) VALUES
 ('50000000-0000-4000-8000-000000000011','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','paid','asaas','production','crm-trial-upgrade','recurring',1,7900,'plink_upgrade11','sub_upgrade11','sub_upgrade11','cus_upgrade11','11144477000161','upgradable@example.test','30000000-0000-4000-8000-000000000011',now()),
 ('50000000-0000-4000-8000-000000000012','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','paid','asaas','production','crm-trial-upgrade','recurring',1,7900,'plink_upgrade12','sub_upgrade12','sub_upgrade12','cus_upgrade12','22244477000161','expired@example.test','30000000-0000-4000-8000-000000000012',now()),
 ('50000000-0000-4000-8000-000000000013','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','paid','asaas','production','crm-trial-upgrade','recurring',1,7900,'plink_upgrade13','sub_upgrade13','sub_upgrade13','cus_upgrade13','33344477000161','unreceived@example.test','30000000-0000-4000-8000-000000000013',now()),
 ('50000000-0000-4000-8000-000000000014','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','paid','asaas','production','crm-trial-upgrade','recurring',1,7900,'plink_upgrade14','sub_upgrade14','sub_upgrade14','cus_upgrade14','44444477000161','courtesy-upgrade@example.test','30000000-0000-4000-8000-000000000014',now());

INSERT INTO public.nexus_payments(
 provider_payment_id,provider,access_id,organization_id,provider_subscription_id,
 provider_customer_id,billing_type,provider_status,amount_cents,currency,received_at
) VALUES
 ('pay_upgrade11','asaas','40000000-0000-4000-8000-000000000011','30000000-0000-4000-8000-000000000011','sub_upgrade11','cus_upgrade11','PIX','RECEIVED',7900,'BRL',now()),
 ('pay_upgrade12','asaas','40000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000012','sub_upgrade12','cus_upgrade12','BOLETO','RECEIVED',7900,'BRL',now()),
 ('pay_upgrade13','asaas','40000000-0000-4000-8000-000000000013','30000000-0000-4000-8000-000000000013','sub_upgrade13','cus_upgrade13','PIX','CONFIRMED',7900,'BRL',null),
 ('pay_upgrade14','asaas','40000000-0000-4000-8000-000000000014','30000000-0000-4000-8000-000000000014','sub_upgrade14','cus_upgrade14','PIX','RECEIVED',7900,'BRL',now());
