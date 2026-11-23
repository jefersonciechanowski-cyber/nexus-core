-- Cortesia administrativa SST, independente do piloto comercial e do Asaas.
-- Reaproveita a transação de provisionamento de empresa/usuário do SST.
-- Executada somente pelo backend com service_role; exige administrador com MFA.
create or replace function public.provision_nexus_sst_courtesy(
  p_user_id uuid,
  p_created_by uuid,
  p_company_name text,
  p_responsible_name text,
  p_email text,
  p_phone text default null,
  p_duration_months integer default 3,
  p_target_plan_code text default 'essencial'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_plan record;
  v_result jsonb;
  v_org_id uuid;
  v_account_id uuid;
  v_access_id uuid;
  v_until date;
begin
  if p_duration_months is null or p_duration_months not in (1,2,3,6,12) then
    raise exception 'Selecione uma vigência de cortesia válida.' using errcode='22023';
  end if;

  -- Rejeita identidades com e-mail divergente antes de atribuir empresa.
  if not exists (
    select 1 from auth.users u
    where u.id=p_user_id and lower(u.email)=lower(btrim(p_email))
  ) then
    raise exception 'A identidade do usuário não corresponde ao e-mail informado.' using errcode='42501';
  end if;

  -- Não criar um segundo cadastro Central para o mesmo e-mail.
  if exists (
    select 1 from public.organizations o
    where lower(btrim(o.email))=lower(btrim(p_email))
  ) then
    raise exception 'Já existe uma empresa com este e-mail na Central. Gerencie o contrato existente.' using errcode='23505';
  end if;

  select p.id, p.name, p.employee_limit, p.currency
    into v_plan
  from public.nexus_plans p
  join public.nexus_products prod on prod.id=p.product_id
  where prod.code='sst'
    and prod.status='active'
    and p.status='active'
    and p.customer_type='single_company'
    and p.code=lower(btrim(coalesce(p_target_plan_code,'')))
    and p.code in ('essencial','profissional','empresarial')
  limit 1;
  if v_plan.id is null then
    raise exception 'Selecione um plano comercial SST válido.' using errcode='22023';
  end if;

  -- Mesma transação: se qualquer etapa falhar, a empresa, o usuário
  -- e o contrato não serão parcialmente persistidos no banco.
  -- Este provisionador exige administrador Nexus ativo e MFA recente.
  v_result := public.provision_nexus_pilot(
    p_user_id, p_created_by, p_company_name,
    p_responsible_name, p_email, p_phone, 1
  );
  v_org_id := (v_result->>'organizationId')::uuid;
  v_account_id := (v_result->>'accountId')::uuid;
  v_access_id := (v_result->>'accessId')::uuid;
  v_until := (current_date + make_interval(months=>p_duration_months))::date;

  update public.nexus_accounts
    set plan_id=v_plan.id, employee_limit_total=v_plan.employee_limit,
        configuration_source='plan'
    where id=v_account_id and billing_organization_id=v_org_id;
  if not found then raise exception 'Conta SST não atualizada.'; end if;

  update public.organization_product_access
    set plan_id=v_plan.id,
        pilot_target_plan_id=null,
        plan_name=v_plan.name || ' · Cortesia',
        access_status='active',
        subscription_status='active',
        commercial_condition='courtesy',
        contracted_price_cents=0,
        contracted_currency='BRL',
        billing_provider=null,
        provider_customer_id=null,
        provider_subscription_id=null,
        asaas_customer_id=null,
        asaas_subscription_id=null,
        last_payment_status=null,
        last_payment_due_date=null,
        last_payment_at=null,
        billing_mode='prepaid',
        billing_cycle_months=case when p_duration_months in (1,3,6,12) then p_duration_months else 1 end,
        renews_at=v_until,
        updated_at=now()
    where id=v_access_id and organization_id=v_org_id;
  if not found then raise exception 'Cortesia SST não registrada.'; end if;

  insert into public.audit_logs(organization_id,user_id,action,entity,entity_id,metadata)
  values (
    v_org_id,p_created_by,'NEXUS_SST_COURTESY_CREATED',
    'organization_product_access',v_access_id::text,
    jsonb_build_object(
      'plan_id',v_plan.id,
      'duration_months',p_duration_months,
      'valid_until',v_until,
      'amount_cents',0,
      'payment_provider',null
    )
  );
  return v_result || jsonb_build_object(
    'planId',v_plan.id, 'planName',v_plan.name,
    'validUntil',v_until, 'courtesy',true
  );
end;
$function$;

revoke all on function public.provision_nexus_sst_courtesy(
  uuid,uuid,text,text,text,text,integer,text
) from PUBLIC, anon, authenticated;
grant execute on function public.provision_nexus_sst_courtesy(
  uuid,uuid,text,text,text,text,integer,text
) to service_role;
