begin;

alter table public.organization_product_access
  add column if not exists crm_sync_revision bigint not null default 0,
  add column if not exists crm_sync_confirmed_revision bigint not null default 0,
  add column if not exists crm_sync_event_type text,
  add column if not exists crm_sync_pending_since timestamptz,
  add column if not exists crm_sync_last_attempt_at timestamptz,
  add column if not exists crm_sync_last_error text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'organization_product_access_crm_sync_revision_check'
      and conrelid = 'public.organization_product_access'::regclass
  ) then
    alter table public.organization_product_access
      add constraint organization_product_access_crm_sync_revision_check
      check (
        crm_sync_revision >= 0
        and crm_sync_confirmed_revision >= 0
        and crm_sync_confirmed_revision <= crm_sync_revision
      );
  end if;
end $$;

-- Existing linked CRM tenants are the synchronization baseline.
update public.organization_product_access access
set crm_sync_revision = 1,
    crm_sync_confirmed_revision = 1,
    crm_sync_event_type = coalesce(crm_sync_event_type, 'baseline.synced')
from public.nexus_products product
where product.id = access.product_id
  and product.code = 'crm'
  and access.external_tenant_id is not null
  and btrim(access.external_tenant_id) <> ''
  and access.crm_sync_revision = 0;

create or replace function public.ensure_crm_sync_delivery(
  p_access_id uuid,
  p_event_type text,
  p_force boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_access public.organization_product_access%rowtype;
  v_product_code text;
  v_revision bigint;
begin
  if p_access_id is null or p_event_type is null or btrim(p_event_type) = '' then
    raise exception 'Entrega CRM inválida.' using errcode = '22023';
  end if;

  select access.*
    into v_access
    from public.organization_product_access access
   where access.id = p_access_id
   for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'access_not_found');
  end if;

  select product.code
    into v_product_code
    from public.nexus_products product
   where product.id = v_access.product_id;

  if v_product_code <> 'crm' then
    return jsonb_build_object('ok', true, 'is_crm', false, 'revision', 0);
  end if;

  if p_force or v_access.crm_sync_revision <= v_access.crm_sync_confirmed_revision then
    v_revision := v_access.crm_sync_revision + 1;
    update public.organization_product_access
       set crm_sync_revision = v_revision,
           crm_sync_event_type = left(btrim(p_event_type), 120),
           crm_sync_pending_since = now(),
           crm_sync_last_error = null,
           updated_at = now()
     where id = p_access_id;
  else
    v_revision := v_access.crm_sync_revision;
    update public.organization_product_access
       set crm_sync_event_type = coalesce(crm_sync_event_type, left(btrim(p_event_type), 120))
     where id = p_access_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'is_crm', true,
    'revision', v_revision,
    'confirmed_revision', v_access.crm_sync_confirmed_revision,
    'pending', v_revision > v_access.crm_sync_confirmed_revision
  );
end;
$$;

create or replace function public.confirm_crm_sync_delivery(
  p_access_id uuid,
  p_revision bigint
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_access_id is null or p_revision is null or p_revision < 1 then
    raise exception 'Confirmação CRM inválida.' using errcode = '22023';
  end if;

  update public.organization_product_access
     set crm_sync_confirmed_revision = greatest(crm_sync_confirmed_revision, least(crm_sync_revision, p_revision)),
         crm_sync_last_attempt_at = now(),
         crm_sync_last_error = case when p_revision >= crm_sync_revision then null else crm_sync_last_error end,
         crm_sync_pending_since = case when p_revision >= crm_sync_revision then null else crm_sync_pending_since end,
         updated_at = now()
   where id = p_access_id;
end;
$$;

create or replace function public.fail_crm_sync_delivery(
  p_access_id uuid,
  p_revision bigint,
  p_error text
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.organization_product_access
     set crm_sync_last_attempt_at = now(),
         crm_sync_last_error = left(coalesce(p_error, 'Falha de sincronização CRM.'), 1000),
         crm_sync_pending_since = coalesce(crm_sync_pending_since, now()),
         updated_at = now()
   where id = p_access_id
     and crm_sync_revision = p_revision;
end;
$$;

revoke all on function public.ensure_crm_sync_delivery(uuid,text,boolean) from public, anon, authenticated;
revoke all on function public.confirm_crm_sync_delivery(uuid,bigint) from public, anon, authenticated;
revoke all on function public.fail_crm_sync_delivery(uuid,bigint,text) from public, anon, authenticated;
grant execute on function public.ensure_crm_sync_delivery(uuid,text,boolean) to service_role;
grant execute on function public.confirm_crm_sync_delivery(uuid,bigint) to service_role;
grant execute on function public.fail_crm_sync_delivery(uuid,bigint,text) to service_role;

create index if not exists idx_org_product_access_crm_sync_pending
  on public.organization_product_access (crm_sync_revision, crm_sync_confirmed_revision)
  where crm_sync_revision > crm_sync_confirmed_revision;

commit;
