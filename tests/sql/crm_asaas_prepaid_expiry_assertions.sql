-- EPHEMERAL PG17 ONLY: exercise the real migration with synthetic data.
alter table public.nexus_payments
  add column if not exists billing_type text,
  add column if not exists provider_status text,
  add column if not exists received_at timestamptz;

insert into public.organization_product_access
 (id,organization_id,product_id,subscription_status,access_status,
  renews_at,billing_provider,commercial_condition,contracted_price_cents,
  billing_mode,external_tenant_id)
 values
 ('40000000-0000-4000-8000-000000000104','30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',
 'active','active',current_date - 1,'asaas','standard',1000,'prepaid','70000000-0000-4000-8000-000000000104'),
 ('40000000-0000-4000-8000-000000000105','30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',
 'active','active',current_date + 1,'asaas','standard',1000,'prepaid','70000000-0000-4000-8000-000000000105'),
 ('40000000-0000-4000-8000-000000000106','30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',
 'active','active',current_date - 1,'asaas','courtesy',1000,'prepaid','70000000-0000-4000-8000-000000000106'),
 ('40000000-0000-4000-8000-000000000107','30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',
 'active','active',current_date - 1,'asaas','standard',1000,'prepaid','70000000-0000-4000-8000-000000000107'),
 ('40000000-0000-4000-8000-000000000108','30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001',
 'active','active',current_date - 1,'asaas','standard',1000,'recurring','70000000-0000-4000-8000-000000000108'),
 ('40000000-0000-4000-8000-000000000109','30000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002',
 'active','active',current_date - 1,'asaas','standard',1000,'prepaid','70000000-0000-4000-8000-000000000109');

insert into public.nexus_payments
 (provider_payment_id,provider,access_id,organization_id,provider_subscription_id,amount_cents,
  billing_type,provider_status,received_at)
 values
 ('pay_asaas_prepaid_104','asaas','40000000-0000-4000-8000-000000000104','30000000-0000-4000-8000-000000000003',null,1000,'PIX','RECEIVED',now()),
 ('pay_asaas_prepaid_105','asaas','40000000-0000-4000-8000-000000000105','30000000-0000-4000-8000-000000000003',null,1000,'PIX','RECEIVED',now()),
 ('pay_asaas_prepaid_106','asaas','40000000-0000-4000-8000-000000000106','30000000-0000-4000-8000-000000000003',null,1000,'PIX','RECEIVED',now()),
 ('pay_asaas_prepaid_108','asaas','40000000-0000-4000-8000-000000000108','30000000-0000-4000-8000-000000000003','sub_fixture108',1000,'PIX','RECEIVED',now()),
 ('pay_asaas_prepaid_109','asaas','40000000-0000-4000-8000-000000000109','30000000-0000-4000-8000-000000000003',null,1000,'PIX','RECEIVED',now());

do $$
declare r jsonb; c int;
begin
  if has_function_privilege('anon','public.expire_nexus_crm_asaas_prepaid_access(uuid)','execute')
   or has_function_privilege('authenticated','public.expire_nexus_crm_asaas_prepaid_access(uuid)','execute')
   or not has_function_privilege('service_role','public.expire_nexus_crm_asaas_prepaid_access(uuid)','execute') then
    raise exception 'Asaas prepaid expiry RPC privilege regression';
  end if;
  r := public.expire_nexus_crm_asaas_prepaid_access('40000000-0000-4000-8000-000000000105');
  if r->>'reason' <> 'not_expired' then raise exception 'future contract suspended: %', r; end if;

  r := public.expire_nexus_crm_asaas_prepaid_access('40000000-0000-4000-8000-000000000106');
  if r->>'reason' <> 'not_eligible' then raise exception 'courtesy contract suspended: %', r; end if;

  r := public.expire_nexus_crm_asaas_prepaid_access('40000000-0000-4000-8000-000000000107');
  if r->>'reason' <> 'paid_receipt_not_verified' then raise exception 'unpaid account suspended: %', r; end if;

  r := public.expire_nexus_crm_asaas_prepaid_access('40000000-0000-4000-8000-000000000108');
  if r->>'reason' <> 'not_eligible' then raise exception 'recurring account changed: %', r; end if;

  r := public.expire_nexus_crm_asaas_prepaid_access('40000000-0000-4000-8000-000000000109');
  if r->>'reason' <> 'not_eligible' then raise exception 'other product changed: %', r; end if;

  r := public.expire_nexus_crm_asaas_prepaid_access('40000000-0000-4000-8000-000000000003');
  if r->>'reason' <> 'not_eligible' then raise exception 'Stripe account changed: %', r; end if;

  r := public.expire_nexus_crm_asaas_prepaid_access('40000000-0000-4000-8000-000000000104');
  if r->>'applied' <> 'true' then raise exception 'paid expiry rejected: %', r; end if;
  r := public.expire_nexus_crm_asaas_prepaid_access('40000000-0000-4000-8000-000000000104');
  if r->>'reason' <> 'already_suspended' then raise exception 'expiry was not idempotent: %',r; end if;
  select count(*) into c from public.organization_product_access
    where id='40000000-0000-4000-8000-000000000104'
      and subscription_status='past_due' and access_status='suspended'
      and provider_state_event_type='reconcile.asaas_prepaid_expired';
  if c<>1 then raise exception 'expiry state failed'; end if;
  select count(*) into c from public.organization_product_access
    where id in (
      '40000000-0000-4000-8000-000000000105',
      '40000000-0000-4000-8000-000000000106',
      '40000000-0000-4000-8000-000000000107',
      '40000000-0000-4000-8000-000000000108',
      '40000000-0000-4000-8000-000000000109')
      and access_status='active' and subscription_status='active';
  if c<>5 then raise exception 'protected accounts changed'; end if;
  select count(*) into c from public.nexus_payments where provider_payment_id='pay_asaas_prepaid_104';
  if c<>1 then raise exception 'payment record changed'; end if;
end $$;
select 'PASS: Asaas prepaid expiry safety + due-date + idempotency' as result;
