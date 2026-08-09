begin;

alter table public.epi_deliveries
  add column if not exists final_disposition text;

-- As devoluções registradas antes desta migration já voltaram ao estoque
-- pelo comportamento anterior e são preservadas com essa classificação.
update public.epi_deliveries
set final_disposition = 'RETURNED_TO_STOCK'
where returned_at is not null
  and final_disposition is null;

update public.epi_deliveries
set final_disposition = null
where returned_at is null
  and final_disposition is not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.epi_deliveries'::regclass
      and conname = 'epi_deliveries_final_disposition_check'
  ) then
    alter table public.epi_deliveries
      add constraint epi_deliveries_final_disposition_check
      check (
        (returned_at is null and final_disposition is null)
        or (
          returned_at is not null
          and final_disposition in ('RETURNED_TO_STOCK', 'DISCARDED')
        )
      ) not valid;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.epi_deliveries'::regclass
      and conname = 'epi_deliveries_discard_reason_check'
  ) then
    alter table public.epi_deliveries
      add constraint epi_deliveries_discard_reason_check
      check (
        final_disposition is distinct from 'DISCARDED'
        or nullif(btrim(return_reason), '') is not null
      ) not valid;
  end if;
end;
$$;

alter table public.epi_deliveries
  validate constraint epi_deliveries_final_disposition_check;

alter table public.epi_deliveries
  validate constraint epi_deliveries_discard_reason_check;

create or replace function public.enforce_epi_delivery_disposition()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.return_reason = nullif(btrim(new.return_reason), '');

  if tg_op = 'INSERT' then
    new.final_disposition = null;
    return new;
  end if;

  if old.returned_at is not null then
    if new.returned_at is distinct from old.returned_at
       or new.final_disposition is distinct from old.final_disposition
       or new.return_reason is distinct from old.return_reason then
      raise exception 'Uma finalização de uso já registrada não pode ser alterada.';
    end if;
    return new;
  end if;

  if new.returned_at is null then
    if new.final_disposition is not null or new.return_reason is not null then
      raise exception 'O destino final e o motivo exigem uma data de encerramento.';
    end if;
    return new;
  end if;

  if new.final_disposition not in ('RETURNED_TO_STOCK', 'DISCARDED') then
    raise exception 'Informe se o EPI retornará ao estoque ou será descartado.';
  end if;

  if new.final_disposition = 'DISCARDED'
     and new.return_reason is null then
    raise exception 'Informe o motivo do descarte ou da baixa do EPI.';
  end if;

  return new;
end;
$$;

drop trigger if exists epi_deliveries_disposition_integrity
  on public.epi_deliveries;

create trigger epi_deliveries_disposition_integrity
before insert or update on public.epi_deliveries
for each row
execute function public.enforce_epi_delivery_disposition();

create or replace function public.enforce_epi_stock_with_disposal()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  purchased_quantity bigint;
  unavailable_quantity bigint;
begin
  if tg_op <> 'INSERT' then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(new.organization_id::text || ':' || new.epi_id::text, 0)
  );

  select coalesce(sum(purchase.quantity), 0)
    into purchased_quantity
  from public.epi_purchases purchase
  where purchase.organization_id = new.organization_id
    and purchase.epi_id = new.epi_id
    and purchase.purchased_at <= new.delivered_at;

  select count(*)
    into unavailable_quantity
  from public.epi_deliveries delivery
  where delivery.organization_id = new.organization_id
    and delivery.epi_id = new.epi_id
    and delivery.delivered_at <= new.delivered_at
    and (
      delivery.final_disposition = 'DISCARDED'
      or delivery.returned_at is null
      or delivery.returned_at > new.delivered_at
    );

  if purchased_quantity <= unavailable_quantity then
    raise exception 'Não há estoque disponível para este EPI na data informada.';
  end if;

  return new;
end;
$$;

drop trigger if exists epi_deliveries_stock_with_disposal
  on public.epi_deliveries;

create trigger epi_deliveries_stock_with_disposal
before insert on public.epi_deliveries
for each row
execute function public.enforce_epi_stock_with_disposal();

grant update (
  returned_at,
  return_reason,
  final_disposition
) on public.epi_deliveries to authenticated;

commit;
