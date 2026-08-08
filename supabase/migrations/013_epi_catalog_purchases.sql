create table public.epi_catalog (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint epi_catalog_name_check check (nullif(btrim(name), '') is not null),
  constraint epi_catalog_code_check check (nullif(btrim(code), '') is not null),
  constraint epi_catalog_organization_code_unique unique (organization_id, code)
);

create table public.epi_purchases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  epi_id uuid not null references public.epi_catalog(id) on delete restrict,
  purchased_at date not null,
  quantity integer not null,
  supplier text,
  invoice_number text,
  technical_responsible text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint epi_purchases_quantity_check check (quantity > 0),
  constraint epi_purchases_supplier_check check (supplier is null or nullif(btrim(supplier), '') is not null),
  constraint epi_purchases_invoice_number_check check (invoice_number is null or nullif(btrim(invoice_number), '') is not null),
  constraint epi_purchases_technical_responsible_check check (nullif(btrim(technical_responsible), '') is not null)
);

create index epi_catalog_organization_active_name_idx
  on public.epi_catalog (organization_id, name)
  where active = true;

create index epi_purchases_organization_epi_purchased_at_idx
  on public.epi_purchases (organization_id, epi_id, purchased_at desc, created_at desc);

alter table public.epi_catalog enable row level security;
alter table public.epi_purchases enable row level security;

create policy "epi catalog tenant select"
  on public.epi_catalog for select
  using (organization_id = public.current_org_id() or public.is_nexus_admin());

create policy "epi catalog tenant insert"
  on public.epi_catalog for insert
  with check (organization_id = public.current_org_id() or public.is_nexus_admin());

create policy "epi catalog tenant update"
  on public.epi_catalog for update
  using (organization_id = public.current_org_id() or public.is_nexus_admin())
  with check (organization_id = public.current_org_id() or public.is_nexus_admin());

create policy "epi purchases tenant select"
  on public.epi_purchases for select
  using (organization_id = public.current_org_id() or public.is_nexus_admin());

create policy "epi purchases tenant insert"
  on public.epi_purchases for insert
  with check (organization_id = public.current_org_id() or public.is_nexus_admin());

create policy "epi purchases tenant update"
  on public.epi_purchases for update
  using (organization_id = public.current_org_id() or public.is_nexus_admin())
  with check (organization_id = public.current_org_id() or public.is_nexus_admin());

create or replace function public.enforce_epi_catalog_integrity()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.name = btrim(new.name);
  new.code = btrim(new.code);

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'O identificador do EPI não pode ser alterado.';
    end if;

    if new.organization_id is distinct from old.organization_id then
      raise exception 'A organização do EPI não pode ser alterada.';
    end if;

    if new.created_at is distinct from old.created_at then
      raise exception 'A data de criação do EPI não pode ser alterada.';
    end if;
  end if;

  return new;
end;
$$;

create trigger epi_catalog_integrity
before insert or update on public.epi_catalog
for each row
execute function public.enforce_epi_catalog_integrity();

create or replace function public.enforce_epi_purchase_integrity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  catalog_organization_id uuid;
  catalog_active boolean;
begin
  new.supplier = nullif(btrim(new.supplier), '');
  new.invoice_number = nullif(btrim(new.invoice_number), '');
  new.technical_responsible = btrim(new.technical_responsible);

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'O identificador da compra de EPI não pode ser alterado.';
    end if;

    if new.organization_id is distinct from old.organization_id then
      raise exception 'A organização da compra de EPI não pode ser alterada.';
    end if;

    if new.created_at is distinct from old.created_at then
      raise exception 'A data de criação da compra de EPI não pode ser alterada.';
    end if;
  end if;

  select organization_id, active
    into catalog_organization_id, catalog_active
  from public.epi_catalog
  where id = new.epi_id;

  if catalog_organization_id is null or catalog_organization_id <> new.organization_id then
    raise exception 'O EPI da compra deve pertencer à mesma organização.';
  end if;

  if (tg_op = 'INSERT' or new.epi_id is distinct from old.epi_id) and not catalog_active then
    raise exception 'Somente EPIs ativos podem receber novas compras.';
  end if;

  return new;
end;
$$;

create trigger epi_purchases_integrity
before insert or update on public.epi_purchases
for each row
execute function public.enforce_epi_purchase_integrity();

create or replace function public.set_epi_catalog_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger epi_catalog_set_updated_at
before update on public.epi_catalog
for each row
execute function public.set_epi_catalog_updated_at();

create or replace function public.set_epi_purchases_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger epi_purchases_set_updated_at
before update on public.epi_purchases
for each row
execute function public.set_epi_purchases_updated_at();

revoke all privileges on table public.epi_catalog, public.epi_purchases
from authenticated, anon, public;

grant select on table public.epi_catalog, public.epi_purchases to authenticated;

grant insert (organization_id, name, code, active)
on public.epi_catalog to authenticated;

grant update (name, code, active)
on public.epi_catalog to authenticated;

grant insert (
  organization_id,
  epi_id,
  purchased_at,
  quantity,
  supplier,
  invoice_number,
  technical_responsible
) on public.epi_purchases to authenticated;

grant update (
  epi_id,
  purchased_at,
  quantity,
  supplier,
  invoice_number,
  technical_responsible
) on public.epi_purchases to authenticated;
