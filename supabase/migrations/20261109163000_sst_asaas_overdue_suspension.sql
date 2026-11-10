-- SST Asaas-specific overdue suspension; run ONLY after the verified checkout migration.
-- This RPC has no knowledge of webhooks; the OIDC worker must first verify
-- overdue invoices in a FRESH GET from Asaas. It never deletes customer data.
begin;
create or replace function public.suspend_verified_nexus_sst_asaas_overdue(
  p_checkout_id uuid,
  p_expected_renews_at date,
  p_grace_days integer
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_checkout public.nexus_sst_asaas_pilot_checkouts%rowtype;
  v_access public.organization_product_access%rowtype;
  v_product text;
begin
  if p_checkout_id is null or p_expected_renews_at is null
     or p_grace_days is null or p_grace_days < 0 or p_grace_days > 30
  then raise exception 'Parâmetros de vencimento inválidos'; end if;
  select * into v_checkout from public.nexus_sst_asaas_pilot_checkouts
    where id=p_checkout_id for update;
  if not found or v_checkout.state<>'paid' or v_checkout.environment<>'production'
    or v_checkout.provider_subscription_id is null
  then raise exception 'Contrato SST não elegível'; end if;
  select * into v_access from public.organization_product_access
    where id=v_checkout.access_id
      and organization_id=v_checkout.organization_id for update;
  if not found then raise exception 'Acesso SST ausente'; end if;
  select code into v_product from public.nexus_products where id=v_access.product_id;
  if v_product<>'sst' or v_access.billing_provider<>'asaas'
    or v_access.plan_id<>v_checkout.plan_id
    or v_access.provider_subscription_id<>v_checkout.provider_subscription_id
    or v_access.provider_customer_id<>v_checkout.provider_customer_id
  then raise exception 'Contrato ou empresa divergente'; end if;

  if v_access.renews_at is distinct from p_expected_renews_at
    then return jsonb_build_object('applied',false,'reason','stale_renewal_date'); end if;
  if p_expected_renews_at + p_grace_days >= current_date
    then return jsonb_build_object('applied',false,'reason','grace_not_elapsed'); end if;
  if v_access.subscription_status='past_due' and v_access.access_status='suspended'
    then return jsonb_build_object('applied',false,'reason','already_suspended'); end if;
  if v_access.subscription_status<>'active' or v_access.access_status<>'active'
    then return jsonb_build_object('applied',false,'reason','not_active'); end if;

  update public.organization_product_access set
    subscription_status='past_due',access_status='suspended',
    last_payment_status='OVERDUE',updated_at=now()
  where id=v_access.id;
  insert into public.audit_logs(organization_id,user_id,action,entity,entity_id,metadata)
  values(v_checkout.organization_id,v_checkout.user_id,
    'NEXUS_SST_ASAAS_PAYMENT_OVERDUE_SUSPENDED',
    'organization_product_access',v_access.id::text,
    jsonb_build_object('checkout_id',v_checkout.id,'renews_at',p_expected_renews_at,'grace_days',p_grace_days));
  return jsonb_build_object('applied',true,'organizationId',v_checkout.organization_id,'accessId',v_access.id);
end;
$$;
revoke all on function public.suspend_verified_nexus_sst_asaas_overdue(uuid,date,integer)
  from public,anon,authenticated;
grant execute on function public.suspend_verified_nexus_sst_asaas_overdue(uuid,date,integer) to service_role;
commit;
