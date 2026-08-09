begin;

create table if not exists public.epi_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete restrict,
  epi_id uuid not null references public.epi_catalog(id) on delete restrict,
  unit_id uuid references public.units(id) on delete restrict,
  sector_id uuid not null references public.sectors(id) on delete restrict,
  job_role_id uuid references public.job_roles(id) on delete restrict,
  matrix_rule_id uuid references public.control_matrix_rules(id) on delete restrict,
  purchase_id uuid references public.epi_purchases(id) on delete restrict,
  delivered_at date not null,
  applied_validity_days integer,
  replacement_due_at date,
  technical_responsible text,
  returned_at date,
  return_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.epi_deliveries
  add column if not exists unit_id uuid,
  add column if not exists job_role_id uuid,
  add column if not exists matrix_rule_id uuid,
  add column if not exists purchase_id uuid,
  add column if not exists applied_validity_days integer,
  add column if not exists technical_responsible text,
  add column if not exists return_reason text,
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.epi_deliveries'::regclass
      and conname = 'epi_deliveries_unit_id_fkey'
  ) then
    alter table public.epi_deliveries
      add constraint epi_deliveries_unit_id_fkey
      foreign key (unit_id) references public.units(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.epi_deliveries'::regclass
      and conname = 'epi_deliveries_job_role_id_fkey'
  ) then
    alter table public.epi_deliveries
      add constraint epi_deliveries_job_role_id_fkey
      foreign key (job_role_id) references public.job_roles(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.epi_deliveries'::regclass
      and conname = 'epi_deliveries_matrix_rule_id_fkey'
  ) then
    alter table public.epi_deliveries
      add constraint epi_deliveries_matrix_rule_id_fkey
      foreign key (matrix_rule_id) references public.control_matrix_rules(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.epi_deliveries'::regclass
      and conname = 'epi_deliveries_purchase_id_fkey'
  ) then
    alter table public.epi_deliveries
      add constraint epi_deliveries_purchase_id_fkey
      foreign key (purchase_id) references public.epi_purchases(id) on delete restrict;
  end if;
end;
$$;

-- Completa registros legados sem apagar ou recriar a tabela.
update public.epi_deliveries delivery
set
  unit_id = coalesce(delivery.unit_id, employee.unit_id),
  sector_id = coalesce(delivery.sector_id, employee.sector_id),
  job_role_id = coalesce(delivery.job_role_id, employee.job_role_id)
from public.employees employee
where employee.id = delivery.employee_id
  and employee.organization_id = delivery.organization_id
  and (
    delivery.unit_id is null
    or delivery.sector_id is null
    or delivery.job_role_id is null
  );

update public.epi_deliveries delivery
set matrix_rule_id = (
  select rule.id
  from public.control_matrix_rules rule
  where rule.organization_id = delivery.organization_id
    and rule.requirement_type = 'EPI'
    and rule.epi_id = delivery.epi_id
    and rule.unit_id = delivery.unit_id
    and rule.sector_id = delivery.sector_id
    and rule.job_role_id = delivery.job_role_id
    and (rule.effective_from is null or rule.effective_from <= delivery.delivered_at)
  order by rule.active desc, rule.effective_from desc nulls last, rule.created_at desc
  limit 1
)
where delivery.matrix_rule_id is null;

update public.epi_deliveries delivery
set applied_validity_days = coalesce(
  delivery.applied_validity_days,
  case
    when delivery.replacement_due_at is not null
      and delivery.replacement_due_at > delivery.delivered_at
    then delivery.replacement_due_at - delivery.delivered_at
  end,
  (select rule.validity_days
   from public.control_matrix_rules rule
   where rule.id = delivery.matrix_rule_id)
)
where delivery.applied_validity_days is null;

update public.epi_deliveries delivery
set purchase_id = (
  select purchase.id
  from public.epi_purchases purchase
  where purchase.organization_id = delivery.organization_id
    and purchase.epi_id = delivery.epi_id
    and purchase.purchased_at <= delivery.delivered_at
  order by purchase.purchased_at desc, purchase.created_at desc
  limit 1
)
where delivery.purchase_id is null;

update public.epi_deliveries delivery
set technical_responsible = purchase.technical_responsible
from public.epi_purchases purchase
where purchase.id = delivery.purchase_id
  and delivery.technical_responsible is null;

update public.epi_deliveries
set replacement_due_at = delivered_at + applied_validity_days
where replacement_due_at is null
  and applied_validity_days is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.epi_deliveries'::regclass
      and conname = 'epi_deliveries_validity_check'
  ) then
    alter table public.epi_deliveries
      add constraint epi_deliveries_validity_check
      check (applied_validity_days is null or applied_validity_days > 0)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.epi_deliveries'::regclass
      and conname = 'epi_deliveries_due_date_check'
  ) then
    alter table public.epi_deliveries
      add constraint epi_deliveries_due_date_check
      check (replacement_due_at is null or replacement_due_at > delivered_at)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.epi_deliveries'::regclass
      and conname = 'epi_deliveries_return_date_check'
  ) then
    alter table public.epi_deliveries
      add constraint epi_deliveries_return_date_check
      check (returned_at is null or returned_at >= delivered_at)
      not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.epi_deliveries'::regclass
      and conname = 'epi_deliveries_responsible_check'
  ) then
    alter table public.epi_deliveries
      add constraint epi_deliveries_responsible_check
      check (
        technical_responsible is null
        or nullif(btrim(technical_responsible), '') is not null
      ) not valid;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.epi_deliveries'::regclass
      and conname = 'epi_deliveries_return_reason_check'
  ) then
    alter table public.epi_deliveries
      add constraint epi_deliveries_return_reason_check
      check (
        return_reason is null
        or (
          returned_at is not null
          and nullif(btrim(return_reason), '') is not null
        )
      ) not valid;
  end if;
end;
$$;

create index if not exists epi_deliveries_org_epi_dates_idx
  on public.epi_deliveries (
    organization_id,
    epi_id,
    delivered_at desc,
    returned_at
  );

create index if not exists epi_deliveries_org_employee_idx
  on public.epi_deliveries (organization_id, employee_id, delivered_at desc);

do $$
begin
  if not exists (
    select 1
    from public.epi_deliveries
    where returned_at is null
    group by organization_id, employee_id, epi_id
    having count(*) > 1
  ) then
    create unique index if not exists epi_deliveries_one_active_per_employee_epi
      on public.epi_deliveries (organization_id, employee_id, epi_id)
      where returned_at is null;
  end if;
end;
$$;

create or replace function public.enforce_epi_delivery_integrity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  employee_row public.employees%rowtype;
  epi_organization_id uuid;
  epi_active boolean;
  matrix_row public.control_matrix_rules%rowtype;
  source_purchase_id uuid;
  source_technical_responsible text;
  purchased_quantity bigint;
  units_in_use bigint;
begin
  new.return_reason = nullif(btrim(new.return_reason), '');

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
       or new.organization_id is distinct from old.organization_id
       or new.employee_id is distinct from old.employee_id
       or new.epi_id is distinct from old.epi_id
       or new.unit_id is distinct from old.unit_id
       or new.sector_id is distinct from old.sector_id
       or new.job_role_id is distinct from old.job_role_id
       or new.matrix_rule_id is distinct from old.matrix_rule_id
       or new.purchase_id is distinct from old.purchase_id
       or new.delivered_at is distinct from old.delivered_at
       or new.applied_validity_days is distinct from old.applied_validity_days
       or new.replacement_due_at is distinct from old.replacement_due_at
       or new.technical_responsible is distinct from old.technical_responsible
       or new.created_at is distinct from old.created_at then
      raise exception 'Os dados originais da entrega de EPI não podem ser alterados.';
    end if;

    if old.returned_at is not null
       and new.returned_at is distinct from old.returned_at then
      raise exception 'Uma devolução já registrada não pode ser alterada.';
    end if;

    if new.returned_at is null then
      raise exception 'Informe a data da devolução do EPI.';
    end if;

    if new.returned_at < new.delivered_at then
      raise exception 'A devolução não pode ser anterior à entrega.';
    end if;

    if new.returned_at > current_date then
      raise exception 'A devolução não pode ser registrada em data futura.';
    end if;

    new.updated_at = now();
    return new;
  end if;

  if new.delivered_at > current_date then
    raise exception 'A entrega não pode ser registrada em data futura.';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.organization_id::text || ':' || new.epi_id::text, 0)
  );

  select * into employee_row
  from public.employees
  where id = new.employee_id;

  if employee_row.id is null
     or employee_row.organization_id <> new.organization_id then
    raise exception 'O colaborador da entrega deve pertencer à mesma organização.';
  end if;

  if not employee_row.active then
    raise exception 'Somente colaboradores ativos podem receber EPIs.';
  end if;

  if employee_row.unit_id is null
     or employee_row.sector_id is null
     or employee_row.job_role_id is null then
    raise exception 'O colaborador precisa possuir unidade, setor e função cadastrados.';
  end if;

  new.unit_id = employee_row.unit_id;
  new.sector_id = employee_row.sector_id;
  new.job_role_id = employee_row.job_role_id;

  select organization_id, active
    into epi_organization_id, epi_active
  from public.epi_catalog
  where id = new.epi_id;

  if epi_organization_id is null
     or epi_organization_id <> new.organization_id then
    raise exception 'O EPI da entrega deve pertencer à mesma organização.';
  end if;

  if not epi_active then
    raise exception 'Somente EPIs ativos podem ser entregues.';
  end if;

  select * into matrix_row
  from public.control_matrix_rules rule
  where rule.organization_id = new.organization_id
    and rule.active = true
    and rule.requirement_type = 'EPI'
    and rule.epi_id = new.epi_id
    and rule.unit_id = new.unit_id
    and rule.sector_id = new.sector_id
    and rule.job_role_id = new.job_role_id
    and (rule.effective_from is null or rule.effective_from <= new.delivered_at)
  order by rule.effective_from desc nulls last, rule.created_at desc
  limit 1;

  if matrix_row.id is null or matrix_row.validity_days <= 0 then
    raise exception 'Não existe uma regra ativa da Matriz para este EPI, setor e função.';
  end if;

  if exists (
    select 1
    from public.epi_deliveries delivery
    where delivery.organization_id = new.organization_id
      and delivery.employee_id = new.employee_id
      and delivery.epi_id = new.epi_id
      and delivery.returned_at is null
  ) then
    raise exception 'Este colaborador já possui este EPI em uso. Registre a devolução antes de uma nova entrega.';
  end if;

  select coalesce(sum(purchase.quantity), 0)
    into purchased_quantity
  from public.epi_purchases purchase
  where purchase.organization_id = new.organization_id
    and purchase.epi_id = new.epi_id
    and purchase.purchased_at <= new.delivered_at;

  select count(*)
    into units_in_use
  from public.epi_deliveries delivery
  where delivery.organization_id = new.organization_id
    and delivery.epi_id = new.epi_id
    and delivery.delivered_at <= new.delivered_at
    and (
      delivery.returned_at is null
      or delivery.returned_at > new.delivered_at
    );

  if purchased_quantity <= units_in_use then
    raise exception 'Não há estoque disponível para este EPI na data informada.';
  end if;

  select purchase.id, purchase.technical_responsible
    into source_purchase_id, source_technical_responsible
  from public.epi_purchases purchase
  where purchase.organization_id = new.organization_id
    and purchase.epi_id = new.epi_id
    and purchase.purchased_at <= new.delivered_at
  order by purchase.purchased_at desc, purchase.created_at desc
  limit 1;

  if source_purchase_id is null
     or nullif(btrim(source_technical_responsible), '') is null then
    raise exception 'A compra de origem precisa possuir um responsável técnico.';
  end if;

  new.matrix_rule_id = matrix_row.id;
  new.purchase_id = source_purchase_id;
  new.applied_validity_days = matrix_row.validity_days;
  new.replacement_due_at = new.delivered_at + matrix_row.validity_days;
  new.technical_responsible = btrim(source_technical_responsible);
  new.returned_at = null;
  new.return_reason = null;
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists epi_deliveries_integrity
  on public.epi_deliveries;

create trigger epi_deliveries_integrity
before insert or update on public.epi_deliveries
for each row
execute function public.enforce_epi_delivery_integrity();

alter table public.epi_deliveries enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'epi_deliveries'
      and cmd = 'SELECT'
  ) then
    create policy "epi deliveries tenant select"
      on public.epi_deliveries for select
      using (organization_id = public.current_org_id() or public.is_nexus_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'epi_deliveries'
      and cmd = 'INSERT'
  ) then
    create policy "epi deliveries tenant insert"
      on public.epi_deliveries for insert
      with check (organization_id = public.current_org_id() or public.is_nexus_admin());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'epi_deliveries'
      and cmd = 'UPDATE'
  ) then
    create policy "epi deliveries tenant update"
      on public.epi_deliveries for update
      using (organization_id = public.current_org_id() or public.is_nexus_admin())
      with check (organization_id = public.current_org_id() or public.is_nexus_admin());
  end if;
end;
$$;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'epi_deliveries'
      and cmd = 'DELETE'
  loop
    execute format(
      'drop policy %I on public.epi_deliveries',
      policy_row.policyname
    );
  end loop;
end;
$$;

revoke all privileges on table public.epi_deliveries
from authenticated, anon, public;

grant select on table public.epi_deliveries to authenticated;

grant insert (
  organization_id,
  employee_id,
  epi_id,
  delivered_at
) on public.epi_deliveries to authenticated;

grant update (
  returned_at,
  return_reason
) on public.epi_deliveries to authenticated;

commit;
