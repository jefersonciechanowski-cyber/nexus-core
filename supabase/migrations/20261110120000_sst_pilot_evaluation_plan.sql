-- SST pilot plan evaluation: keep the non-billable pilot entitlement intact
-- while recording the commercial tier being evaluated. No paid access is granted.
begin;

alter table public.organization_product_access
  add column if not exists pilot_target_plan_id uuid
  references public.nexus_plans(id) on delete set null;

comment on column public.organization_product_access.pilot_target_plan_id is
  'Commercial SST plan being evaluated during an unpaid pilot; plan_id stays SST piloto. Not a financial entitlement.';

create or replace function public.validate_sst_pilot_target_plan()
returns trigger
language plpgsql security invoker set search_path='public'
as $$
declare
  v_product_code text;
  v_target_code text;
begin
  if new.pilot_target_plan_id is null then return new; end if;
  select product.code into v_product_code from public.nexus_products product
    where product.id=new.product_id;
  if v_product_code <> 'sst' or new.subscription_status <> 'trial' then
    -- Keep the historical evaluation selection when a pilot becomes paid.
    if tg_op = 'UPDATE' and old.pilot_target_plan_id is not distinct from new.pilot_target_plan_id
      then return new; end if;
    raise exception 'Plano avaliado só pode ser definido para piloto SST.'
      using errcode='23514';
  end if;
  select plan.code into v_target_code
  from public.nexus_plans plan
  join public.nexus_products product on product.id=plan.product_id
  where plan.id=new.pilot_target_plan_id
    and plan.status='active'
    and product.code='sst'
    and plan.code in ('essencial','profissional','empresarial');
  if v_target_code is null then
    raise exception 'Plano comercial de avaliação inválido.'
      using errcode='23514';
  end if;
  return new;
end;
$$;

drop trigger if exists sst_pilot_target_plan_guard on public.organization_product_access;
create trigger sst_pilot_target_plan_guard
before insert or update of pilot_target_plan_id on public.organization_product_access
for each row execute function public.validate_sst_pilot_target_plan();
revoke all on function public.validate_sst_pilot_target_plan() from public,anon,authenticated;

-- Existing provision_nexus_pilot stays unchanged for compatibility.
-- New RPC atomically provisions the pilot and records the approved target tier.
create or replace function public.provision_nexus_pilot_with_plan(
  p_user_id uuid,
  p_created_by uuid,
  p_company_name text,
  p_responsible_name text,
  p_email text,
  p_phone text default null,
  p_days integer default 15,
  p_target_plan_code text default 'essencial'
)
returns jsonb
language plpgsql security definer set search_path='public','pg_temp'
as $$
declare
  v_target uuid;
  v_result jsonb;
  v_access uuid;
begin
  select plan.id into v_target
  from public.nexus_plans plan
  join public.nexus_products product on product.id=plan.product_id
  where product.code='sst' and product.status='active'
    and plan.code=lower(btrim(coalesce(p_target_plan_code,'')))
    and plan.code in ('essencial','profissional','empresarial')
    and plan.status='active'
    and plan.customer_type='single_company'
  limit 1;
  if v_target is null then
    raise exception 'Selecione um plano SST válido para o teste.'
      using errcode='22023';
  end if;
  v_result := public.provision_nexus_pilot(
    p_user_id,p_created_by,p_company_name,p_responsible_name,
    p_email,p_phone,p_days
  );
  v_access := (v_result->>'accessId')::uuid;
  update public.organization_product_access
    set pilot_target_plan_id=v_target
  where id=v_access and subscription_status='trial';
  if not found then raise exception 'Falha ao registrar o plano de teste.'
    using errcode='P0001'; end if;

  return v_result || jsonb_build_object(
    'pilotTargetPlanId',v_target,
    'pilotTargetPlanCode',lower(btrim(p_target_plan_code))
  );
end;
$$;
revoke all on function public.provision_nexus_pilot_with_plan(
  uuid,uuid,text,text,text,text,integer,text
) from public,anon,authenticated;
grant execute on function public.provision_nexus_pilot_with_plan(
  uuid,uuid,text,text,text,text,integer,text
) to service_role;

-- The active employee ceiling follows the evaluated tier during a trial
-- (50/100/250); after payment, the paid plan takes over normally.
do $$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    where p.pronamespace='public'::regnamespace and p.proname='enforce_sst_employee_plan_limit';
  if v_def is null
    or position('select plan.employee_limit into v_limit' in v_def)=0
    or position('left join public.nexus_plans plan on plan.id = access.plan_id' in v_def)=0
  then raise exception 'A política atual de limite de colaboradores mudou: revisão manual necessária.'; end if;
  v_def := replace(v_def,
    'select plan.employee_limit into v_limit',
    'select coalesce(target_plan.employee_limit,plan.employee_limit) into v_limit');
  v_def := replace(v_def,
    'left join public.nexus_plans plan on plan.id = access.plan_id',
    'left join public.nexus_plans plan on plan.id = access.plan_id
  left join public.nexus_plans target_plan on target_plan.id = access.pilot_target_plan_id
    and access.subscription_status = ''trial''');
  execute v_def;
end $$;
commit;
