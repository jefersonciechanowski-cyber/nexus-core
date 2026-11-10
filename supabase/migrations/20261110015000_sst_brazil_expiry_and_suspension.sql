-- Brazil-local trial expiry and an auditable, service-role-only SST pilot
-- suspension operation. The paid checkout/renewal path remains untouched.
begin;

do $$
declare
  v_def text;
  v_updated text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='private' and p.proname='sst_operational_access_allowed';
  if v_def is null or v_def not like '%current_date%' then
    raise exception 'Função de validade SST indisponível ou alterada inesperadamente';
  end if;
  -- Supabase/Postgres defaults to UTC; SST contract dates are Brazil-local.
  v_updated := replace(v_def, 'current_date',
    '(now() at time zone ''America/Sao_Paulo'')::date');
  execute v_updated;
end $$;

create or replace function public.suspend_expired_nexus_sst_trials()
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_local_date date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  -- Never affect paid contracts, courtesy access, or other products.
  with expired as (
    update public.organization_product_access a
    set access_status='suspended',updated_at=now()
    from public.nexus_products product
    join public.nexus_plans plan on plan.product_id=product.id
    where product.id=a.product_id and product.code='sst'
      and plan.id=a.plan_id and plan.code='piloto'
      and a.subscription_status='trial' and a.access_status='active'
      and a.renews_at is not null and a.renews_at < v_local_date
    returning a.id,a.organization_id,a.renews_at
  ),
  audit as (
    insert into public.audit_logs(organization_id,user_id,action,entity,entity_id,metadata)
    select e.organization_id,null,'NEXUS_SST_TRIAL_EXPIRED',
      'organization_product_access',e.id::text,
      jsonb_build_object('expired_on',e.renews_at,'checked_on',v_local_date)
    from expired e
    returning 1
  )
  select count(*) into v_count from audit;
  return jsonb_build_object('suspended',v_count,'checkedOn',v_local_date);
end;
$$;

revoke all on function public.suspend_expired_nexus_sst_trials()
  from public,anon,authenticated;
grant execute on function public.suspend_expired_nexus_sst_trials()
  to service_role;

commit;
