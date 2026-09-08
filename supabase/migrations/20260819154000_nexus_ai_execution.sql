-- Nexus AI Core v0.1 — transactional reservation/finalization for server-side execution.
-- These RPCs are intentionally service-role only; signed-in users must go through
-- an authenticated server/Edge Function that derives user and organization context.

create or replace function public.reserve_nexus_ai_usage(
  p_organization_id uuid,
  p_user_id uuid,
  p_product_code text,
  p_capability text,
  p_reserved_tokens integer,
  p_reserved_cost_microusd bigint default 0
)
returns public.nexus_ai_usage_events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entitlement public.nexus_ai_entitlements%rowtype;
  v_control public.nexus_ai_controls%rowtype;
  v_user_access public.nexus_ai_user_access%rowtype;
  v_month_start timestamptz := date_trunc('month', now());
  v_request_count bigint := 0;
  v_token_count bigint := 0;
  v_cost_count bigint := 0;
  v_event public.nexus_ai_usage_events%rowtype;
begin
  if p_organization_id is null or p_user_id is null then
    raise exception 'AI context is required';
  end if;
  if nullif(btrim(p_product_code), '') is null or nullif(btrim(p_capability), '') is null then
    raise exception 'AI product and capability are required';
  end if;
  if p_reserved_tokens < 1 or p_reserved_tokens > 200000 then
    raise exception 'Invalid AI token reservation';
  end if;
  if p_reserved_cost_microusd < 0 then
    raise exception 'Invalid AI cost reservation';
  end if;

  -- Serializes reservations for the same organization/product/month so concurrent
  -- requests cannot consume the same remaining quota.
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':' || p_product_code || ':' || to_char(v_month_start, 'YYYY-MM'), 0)
  );

  select * into v_entitlement
  from public.nexus_ai_entitlements
  where organization_id = p_organization_id
    and product_code = p_product_code
  for update;

  if not found or not v_entitlement.enabled then
    raise exception 'Nexus AI is not enabled for this organization/product';
  end if;
  if v_entitlement.provider_mode <> 'nexus_managed' then
    raise exception 'This execution path only supports nexus_managed provider mode';
  end if;
  if now() < v_entitlement.starts_at or (v_entitlement.ends_at is not null and now() >= v_entitlement.ends_at) then
    raise exception 'Nexus AI entitlement is outside its validity window';
  end if;
  if not (v_entitlement.capabilities ? p_capability) then
    raise exception 'Nexus AI capability is not included in this package';
  end if;

  select * into v_control
  from public.nexus_ai_controls
  where organization_id = p_organization_id
    and product_code = p_product_code;

  if not found or not v_control.customer_enabled then
    raise exception 'Nexus AI is disabled by customer control';
  end if;
  if v_control.paused_until is not null and v_control.paused_until > now() then
    raise exception 'Nexus AI is temporarily paused';
  end if;

  select * into v_user_access
  from public.nexus_ai_user_access
  where organization_id = p_organization_id
    and product_code = p_product_code
    and user_id = p_user_id;

  if found then
    if v_user_access.access_mode = 'block' then
      raise exception 'Nexus AI is blocked for this user';
    end if;
    if v_user_access.access_mode = 'pause'
       and v_user_access.paused_until is not null
       and v_user_access.paused_until > now() then
      raise exception 'Nexus AI is paused for this user';
    end if;
  end if;

  select
    count(*),
    coalesce(sum(case when status = 'reserved' then reserved_tokens else total_tokens end), 0),
    coalesce(sum(estimated_cost_microusd), 0)
  into v_request_count, v_token_count, v_cost_count
  from public.nexus_ai_usage_events
  where organization_id = p_organization_id
    and product_code = p_product_code
    and created_at >= v_month_start
    and status in ('reserved','success','error');

  if v_request_count >= v_entitlement.monthly_request_limit then
    raise exception 'Nexus AI monthly request limit reached';
  end if;
  if v_token_count + p_reserved_tokens > v_entitlement.monthly_token_limit then
    raise exception 'Nexus AI monthly token limit reached';
  end if;
  if v_entitlement.monthly_cost_limit_microusd is not null
     and v_cost_count + p_reserved_cost_microusd > v_entitlement.monthly_cost_limit_microusd then
    raise exception 'Nexus AI monthly cost limit reached';
  end if;

  insert into public.nexus_ai_usage_events (
    organization_id, product_code, user_id, capability, package_code,
    provider, status, reserved_tokens, estimated_cost_microusd
  ) values (
    p_organization_id, p_product_code, p_user_id, p_capability, v_entitlement.package_code,
    'openai', 'reserved', p_reserved_tokens, p_reserved_cost_microusd
  ) returning * into v_event;

  return v_event;
end;
$$;

create or replace function public.finalize_nexus_ai_usage(
  p_event_id uuid,
  p_status text,
  p_model text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_total_tokens integer,
  p_estimated_cost_microusd bigint
)
returns public.nexus_ai_usage_events
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.nexus_ai_usage_events%rowtype;
begin
  if p_status not in ('success','error','cancelled') then
    raise exception 'Invalid AI final status';
  end if;
  if least(p_input_tokens, p_output_tokens, p_total_tokens) < 0 then
    raise exception 'Invalid AI token usage';
  end if;
  if p_total_tokens < p_input_tokens or p_total_tokens < p_output_tokens then
    raise exception 'Invalid AI total token usage';
  end if;
  if p_estimated_cost_microusd is not null and p_estimated_cost_microusd < 0 then
    raise exception 'Invalid AI cost usage';
  end if;

  update public.nexus_ai_usage_events
  set status = p_status,
      model = nullif(btrim(p_model), ''),
      input_tokens = p_input_tokens,
      output_tokens = p_output_tokens,
      total_tokens = p_total_tokens,
      estimated_cost_microusd = p_estimated_cost_microusd,
      finalized_at = now()
  where id = p_event_id
    and status = 'reserved'
  returning * into v_event;

  if not found then
    raise exception 'AI usage event was not found or already finalized';
  end if;

  return v_event;
end;
$$;

revoke all on function public.reserve_nexus_ai_usage(uuid,uuid,text,text,integer,bigint) from public, anon, authenticated;
revoke all on function public.finalize_nexus_ai_usage(uuid,text,text,integer,integer,integer,bigint) from public, anon, authenticated;
grant execute on function public.reserve_nexus_ai_usage(uuid,uuid,text,text,integer,bigint) to service_role;
grant execute on function public.finalize_nexus_ai_usage(uuid,text,text,integer,integer,integer,bigint) to service_role;
