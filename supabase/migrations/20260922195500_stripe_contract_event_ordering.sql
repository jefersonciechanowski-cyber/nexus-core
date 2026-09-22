-- Commercial readiness Part 3: deterministic Stripe contract state ordering.

alter table public.organization_product_access
  add column if not exists provider_state_event_created_at timestamptz,
  add column if not exists provider_state_event_id text,
  add column if not exists provider_state_event_type text;

create or replace function public.apply_stripe_contract_state(
  p_access_id uuid,
  p_event_id text,
  p_event_created_at timestamptz,
  p_event_type text,
  p_subscription_status text,
  p_access_status text,
  p_provider_customer_id text default null,
  p_provider_subscription_id text default null,
  p_last_payment_status text default null,
  p_last_payment_at timestamptz default null,
  p_last_payment_due_date date default null,
  p_renews_at date default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_access public.organization_product_access%rowtype;
  v_current_rank integer;
  v_incoming_rank integer;
begin
  if p_access_id is null
     or p_event_id is null or btrim(p_event_id) = ''
     or p_event_created_at is null
     or p_event_type is null or btrim(p_event_type) = '' then
    raise exception 'Evento Stripe inválido.' using errcode = '22023';
  end if;

  if p_subscription_status not in ('active','trial','past_due','cancelled')
     or p_access_status not in ('active','suspended') then
    raise exception 'Estado comercial Stripe inválido.' using errcode = '22023';
  end if;

  select *
    into v_access
    from public.organization_product_access
   where id = p_access_id
   for update;

  if not found then
    return jsonb_build_object('applied', false, 'reason', 'access_not_found');
  end if;

  if v_access.billing_provider is distinct from 'stripe' then
    return jsonb_build_object('applied', false, 'reason', 'not_stripe_contract');
  end if;

  if p_provider_customer_id is not null
     and v_access.provider_customer_id is not null
     and v_access.provider_customer_id <> p_provider_customer_id then
    return jsonb_build_object('applied', false, 'reason', 'provider_customer_mismatch');
  end if;

  if p_provider_subscription_id is not null
     and v_access.provider_subscription_id is not null
     and v_access.provider_subscription_id <> p_provider_subscription_id then
    return jsonb_build_object('applied', false, 'reason', 'provider_subscription_mismatch');
  end if;

  -- Cancellation is terminal for the same stored contract/subscription.
  -- Reactivation must arrive through an explicit new sale/provisioning flow.
  if v_access.subscription_status = 'cancelled'
     and p_subscription_status <> 'cancelled' then
    return jsonb_build_object(
      'applied', false,
      'reason', 'terminal_cancelled',
      'subscription_status', v_access.subscription_status,
      'access_status', v_access.access_status
    );
  end if;

  v_current_rank := case
    when v_access.subscription_status = 'cancelled' then 30
    when v_access.subscription_status = 'past_due' or v_access.access_status = 'suspended' then 20
    else 10
  end;

  v_incoming_rank := case
    when p_subscription_status = 'cancelled' then 30
    when p_subscription_status = 'past_due' or p_access_status = 'suspended' then 20
    else 10
  end;

  if v_access.provider_state_event_id = p_event_id then
    return jsonb_build_object(
      'applied', false,
      'reason', 'duplicate',
      'subscription_status', v_access.subscription_status,
      'access_status', v_access.access_status
    );
  end if;

  if v_access.provider_state_event_created_at is not null then
    if p_event_created_at < v_access.provider_state_event_created_at then
      return jsonb_build_object(
        'applied', false,
        'reason', 'stale_event',
        'subscription_status', v_access.subscription_status,
        'access_status', v_access.access_status
      );
    end if;

    if p_event_created_at = v_access.provider_state_event_created_at
       and v_incoming_rank <= v_current_rank then
      return jsonb_build_object(
        'applied', false,
        'reason', 'same_timestamp_lower_or_equal_priority',
        'subscription_status', v_access.subscription_status,
        'access_status', v_access.access_status
      );
    end if;
  end if;

  update public.organization_product_access
     set subscription_status = p_subscription_status,
         access_status = p_access_status,
         provider_customer_id = coalesce(p_provider_customer_id, provider_customer_id),
         provider_subscription_id = coalesce(p_provider_subscription_id, provider_subscription_id),
         last_payment_status = coalesce(p_last_payment_status, last_payment_status),
         last_payment_at = coalesce(p_last_payment_at, last_payment_at),
         last_payment_due_date = coalesce(p_last_payment_due_date, last_payment_due_date),
         renews_at = coalesce(p_renews_at, renews_at),
         provider_state_event_created_at = p_event_created_at,
         provider_state_event_id = p_event_id,
         provider_state_event_type = p_event_type,
         updated_at = now()
   where id = p_access_id;

  return jsonb_build_object(
    'applied', true,
    'reason', 'applied',
    'subscription_status', p_subscription_status,
    'access_status', p_access_status,
    'event_id', p_event_id,
    'event_created_at', p_event_created_at
  );
end;
$$;

revoke all on function public.apply_stripe_contract_state(
  uuid,text,timestamptz,text,text,text,text,text,text,timestamptz,date,date
) from public;
revoke all on function public.apply_stripe_contract_state(
  uuid,text,timestamptz,text,text,text,text,text,text,timestamptz,date,date
) from anon;
revoke all on function public.apply_stripe_contract_state(
  uuid,text,timestamptz,text,text,text,text,text,text,timestamptz,date,date
) from authenticated;
grant execute on function public.apply_stripe_contract_state(
  uuid,text,timestamptz,text,text,text,text,text,text,timestamptz,date,date
) to service_role;

create index if not exists idx_org_product_access_provider_state_event
  on public.organization_product_access (provider_state_event_created_at)
  where billing_provider = 'stripe';
