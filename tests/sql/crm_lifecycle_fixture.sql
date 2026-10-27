-- Synthetic lifecycle fixtures. Execute ONLY after previous billing tests.
-- One Asaas customer, one subscription, one settled invoice, no real accounts.
INSERT INTO public.organizations(id,registration_number,email) VALUES
 ('30000000-0000-4000-8000-000000000004','44440000111122','asaas-lifecycle@example.test');
INSERT INTO public.organization_product_access(
  id,organization_id,product_id,subscription_status,access_status,renews_at,
  billing_provider,commercial_condition,contracted_price_cents,billing_mode,
  provider_subscription_id,external_tenant_id
) VALUES
 ('40000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000004',
 '10000000-0000-4000-8000-000000000001','active','active',current_date+20,
 'asaas','standard',7900,'recurring','sub_lifecycle123','crm_fake_tenant');
INSERT INTO public.nexus_sales(
 id,product_id,plan_id,sale_status,provider,environment,source,billing_mode,
 billing_cycle_months,checkout_amount_cents,asaas_checkout_id,asaas_subscription_id,
 provider_subscription_id,registration_number,email,organization_id
) VALUES
 ('50000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001',
 '20000000-0000-4000-8000-000000000001','provisioned','asaas','sandbox',
 'site-captacao','recurring',1,7900,'plink_lifecycle123','sub_lifecycle123',
 'sub_lifecycle123','44440000111122','asaas-lifecycle@example.test',
 '30000000-0000-4000-8000-000000000004');
INSERT INTO public.nexus_payments(
 provider_payment_id,provider,access_id,organization_id,provider_subscription_id,amount_cents
) VALUES ('pay_lifecycle123','asaas','40000000-0000-4000-8000-000000000004',
 '30000000-0000-4000-8000-000000000004','sub_lifecycle123',7900);

INSERT INTO public.nexus_payment_webhook_events
(provider_event_id,provider,event_type,payload,created_at) VALUES
('asaas:evt_overdue1234','asaas','PAYMENT_OVERDUE',
 '{"event":"PAYMENT_OVERDUE","resource":{"id":"pay_lifecycle123","subscription":"sub_lifecycle123"}}',
 now()-interval '7 day'),
('asaas:evt_inactive1234','asaas','SUBSCRIPTION_INACTIVATED',
 '{"event":"SUBSCRIPTION_INACTIVATED","resource":{"id":"sub_lifecycle123"}}',
 now()-interval '6 day'),
('asaas:evt_received1234','asaas','PAYMENT_RECEIVED',
 '{"event":"PAYMENT_RECEIVED","resource":{"id":"pay_lifecycle123","subscription":"sub_lifecycle123"}}',
 now()-interval '5 day'),
('asaas:evt_refund12345','asaas','PAYMENT_REFUNDED',
 '{"event":"PAYMENT_REFUNDED","resource":{"id":"pay_lifecycle123","subscription":"sub_lifecycle123"}}',
 now()-interval '4 day'),
('asaas:evt_repaid12345','asaas','PAYMENT_RECEIVED',
 '{"event":"PAYMENT_RECEIVED","resource":{"id":"pay_lifecycle123","subscription":"sub_lifecycle123"}}',
 now()-interval '3 day'),
('asaas:evt_deleted1234','asaas','SUBSCRIPTION_DELETED',
 '{"event":"SUBSCRIPTION_DELETED","resource":{"id":"sub_lifecycle123"}}',
 now()-interval '2 day'),
('asaas:evt_oldpaid1234','asaas','PAYMENT_RECEIVED',
 '{"event":"PAYMENT_RECEIVED","resource":{"id":"pay_lifecycle123","subscription":"sub_lifecycle123"}}',
 now()-interval '1 day');
