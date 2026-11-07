-- Nexus CRM Asaas recurring PRODUCTION: service-only, provider-verified
-- monthly invoice ledger. This migration installs only a function: it does
-- NOT call Asaas, receive webhooks, create subscriptions or charge customers.
-- The independently authenticated worker must GET Asaas invoice, subscription,
-- customer and payment link immediately before invoking this RPC.
begin;

create or replace function public.record_nexus_crm_asaas_production_renewal(
 p_sale_id uuid, p_access_id uuid, p_provider_event_id text,
 p_provider_payment_id text, p_provider_customer_id text,
 p_amount_cents bigint, p_billing_type text, p_provider_status text,
 p_due_date date, p_next_due_date date
) returns jsonb language plpgsql security definer set search_path=''
as $$
declare
 v_sale public.nexus_sales%rowtype;
 v_access public.organization_product_access%rowtype;
 v_event public.nexus_crm_asaas_production_events%rowtype;
 v_payment public.nexus_payments%rowtype;
 v_event_time timestamptz;
 v_raw_time text;
 v_price numeric;
begin
 if p_sale_id is null or p_access_id is null
   or p_provider_event_id !~ '^asaas:evt_[A-Za-z0-9_&.-]{6,150}$'
   or p_provider_payment_id !~ '^pay_[A-Za-z0-9_-]{5,120}$'
   or p_provider_customer_id !~ '^cus_[A-Za-z0-9_-]{5,120}$'
   or p_amount_cents is null or p_amount_cents<1
   or p_billing_type not in ('PIX','BOLETO')
   or p_provider_status not in ('RECEIVED','CONFIRMED')
   or p_due_date is null or p_next_due_date is null
   or p_next_due_date<=p_due_date
   or p_due_date>current_date+62
   or p_next_due_date>p_due_date+90 then
   return pg_catalog.jsonb_build_object('decision','manual_review','reason','invalid_renewal_input');
 end if;
 -- The access lock serializes competing invoices and retries for one CRM.
 select * into v_access from public.organization_product_access
  where id=p_access_id for update;
 if not found
   or v_access.billing_provider is distinct from 'asaas'
   or v_access.billing_mode is distinct from 'recurring'
   or v_access.billing_cycle_months is distinct from 1
   or v_access.commercial_condition is distinct from 'standard'
   or v_access.subscription_status='cancelled'
   or v_access.external_tenant_id is null
   or v_access.provider_subscription_id is null
   or v_access.contracted_price_cents is distinct from p_amount_cents
   or v_access.contracted_currency is distinct from 'BRL'
   or v_access.provider_customer_id is distinct from p_provider_customer_id
   or not exists(select 1 from public.nexus_products p
      where p.id=v_access.product_id and p.code='crm') then
   return pg_catalog.jsonb_build_object('decision','manual_review','reason','access_not_eligible');
 end if;
 select * into v_sale from public.nexus_sales s
 where id=p_sale_id and product_id=v_access.product_id
   and organization_id=v_access.organization_id and provider='asaas'
   and environment='production' and source='site-captacao'
   and billing_mode='recurring' and billing_cycle_months=1
   and sale_status='provisioned' and provisioned_at is not null
   and asaas_subscription_id=v_access.provider_subscription_id
   and provider_customer_id=p_provider_customer_id
   and checkout_amount_cents=p_amount_cents;
 if not found then
   return pg_catalog.jsonb_build_object('decision','manual_review','reason','sale_not_linked');
 end if;
 -- Existing receipts are allowed only for exact same company/subscription;
 -- they cannot extend access or re-grant a cancelled account on replay.
 select * into v_payment from public.nexus_payments
  where provider_payment_id=p_provider_payment_id;
 if found then
   if v_payment.provider='asaas' and v_payment.organization_id=v_access.organization_id
     and v_payment.access_id=p_access_id
     and v_payment.provider_subscription_id=v_access.provider_subscription_id
     and v_payment.provider_customer_id=p_provider_customer_id
     and v_payment.amount_cents=p_amount_cents
     and v_payment.currency='BRL'
     and v_payment.due_date=p_due_date then
     return pg_catalog.jsonb_build_object('decision','already_recorded',
       'access_id',p_access_id,'delivery_pending',v_access.crm_sync_revision>v_access.crm_sync_confirmed_revision);
   end if;
   return pg_catalog.jsonb_build_object('decision','manual_review','reason','payment_owned_elsewhere');
 end if;
 -- One invoice for the same billing date; a later payment for another ID
 -- on that same cycle cannot silently extend access twice.
 if exists(select 1 from public.nexus_payments p
    where p.access_id=p_access_id and p.provider='asaas'
      and p.provider_subscription_id=v_access.provider_subscription_id
      and p.due_date=p_due_date) then
   return pg_catalog.jsonb_build_object('decision','manual_review','reason','cycle_already_recorded');
 end if;
 select * into v_event from public.nexus_crm_asaas_production_events
  where provider_event_id=p_provider_event_id and environment='production'
    and event_type in ('PAYMENT_RECEIVED','PAYMENT_CONFIRMED');
 if not found or v_event.payload->>'event' is distinct from v_event.event_type
   or v_event.resource_id is distinct from p_provider_payment_id
   or v_event.payload#>>'{resource,id}' is distinct from p_provider_payment_id
   or v_event.payload#>>'{resource,subscription}' is distinct from v_access.provider_subscription_id
   or v_event.payload#>>'{resource,billingType}' is distinct from p_billing_type
   or v_event.payload#>>'{resource,dueDate}' is distinct from p_due_date::text
   or pg_catalog.jsonb_typeof(v_event.payload#>'{resource,value}') is distinct from 'number'
   or coalesce((v_event.payload#>>'{resource,value}') ~ '^[0-9]{1,12}([.][0-9]{1,2})?$',false) is not true then
   return pg_catalog.jsonb_build_object('decision','manual_review','reason','event_not_linked');
 end if;
 v_price:=(v_event.payload#>>'{resource,value}')::numeric;
 if pg_catalog.round(v_price*100)::bigint<>p_amount_cents then
   return pg_catalog.jsonb_build_object('decision','manual_review','reason','event_amount_mismatch');
 end if;
 v_raw_time:=v_event.payload->>'dateCreated';
 if v_raw_time is null or v_raw_time !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}([.]\d+)?(Z|[+-]\d{2}:\d{2})$' then
   return pg_catalog.jsonb_build_object('decision','manual_review','reason','event_time_not_normalized');
 end if;
 begin
  v_event_time:=v_raw_time::timestamptz;
 exception when others then
  return pg_catalog.jsonb_build_object('decision','manual_review','reason','event_time_invalid');
 end;
 if v_event_time>pg_catalog.now()+interval '5 minutes'
   or (v_access.provider_state_event_created_at is not null
       and v_event_time<=v_access.provider_state_event_created_at)
   or (v_access.last_payment_due_date is not null
       and p_due_date<=v_access.last_payment_due_date) then
   return pg_catalog.jsonb_build_object('decision','hold','reason','old_payment_or_event');
 end if;
 insert into public.nexus_payments (
   organization_id,access_id,provider,provider_payment_id,
   provider_subscription_id,provider_customer_id,billing_type,
   provider_status,amount_cents,currency,due_date,confirmed_at,
   received_at,external_reference
 ) values (
   v_access.organization_id,p_access_id,'asaas',p_provider_payment_id,
   v_access.provider_subscription_id,p_provider_customer_id,p_billing_type,
   p_provider_status,p_amount_cents,'BRL',p_due_date,pg_catalog.now(),
   case when p_provider_status='RECEIVED' then pg_catalog.now() else null end,
   v_sale.external_reference
 ) on conflict do nothing;
 if not found then
   return pg_catalog.jsonb_build_object('decision','manual_review','reason','payment_raced_or_conflicted');
 end if;
 update public.organization_product_access
 set subscription_status='active',access_status='active',renews_at=p_next_due_date,
   last_payment_due_date=p_due_date,last_payment_status=v_event.event_type,
   last_payment_at=pg_catalog.now(),provider_state_event_id=p_provider_event_id,
   provider_state_event_created_at=v_event_time,provider_state_event_type=v_event.event_type,
   updated_at=pg_catalog.now()
 where id=p_access_id;
 return pg_catalog.jsonb_build_object('decision','renewal_recorded',
  'access_id',p_access_id,'delivery_pending',true);
end; $$;
revoke all on function public.record_nexus_crm_asaas_production_renewal(
 uuid,uuid,text,text,text,bigint,text,text,date,date) from public,anon,authenticated;
grant execute on function public.record_nexus_crm_asaas_production_renewal(
 uuid,uuid,text,text,text,bigint,text,text,date,date) to service_role;
commit;
