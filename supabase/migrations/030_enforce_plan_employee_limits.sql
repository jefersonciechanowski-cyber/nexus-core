begin;

create or replace function public.enforce_sst_employee_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_active_count integer;
begin
  if coalesce(new.active, true) is not true then
    return new;
  end if;

  select p.employee_limit
    into v_limit
  from public.organization_product_access access
  join public.nexus_products product on product.id = access.product_id
  left join public.nexus_plans p on p.id = access.plan_id
  where access.organization_id = new.organization_id
    and product.code = 'sst'
    and access.access_status = 'active'
  order by access.created_at desc
  limit 1;

  -- Acessos legados ou corporativos sem limite explícito permanecem sem bloqueio quantitativo.
  if v_limit is null then
    return new;
  end if;

  select count(*)::integer
    into v_active_count
  from public.employees employee
  where employee.organization_id = new.organization_id
    and employee.active = true
    and (tg_op = 'INSERT' or employee.id <> new.id);

  if v_active_count >= v_limit then
    raise exception 'Limite de % colaboradores ativos atingido para o plano contratado.', v_limit
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists employees_plan_limit_guard on public.employees;
create trigger employees_plan_limit_guard
before insert or update of active, organization_id on public.employees
for each row
execute function public.enforce_sst_employee_plan_limit();

comment on function public.enforce_sst_employee_plan_limit() is
  'Impede que a quantidade de colaboradores ativos ultrapasse o limite comercial do plano Nexus SST.';

commit;
