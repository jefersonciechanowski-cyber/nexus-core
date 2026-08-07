create table public.training_catalog (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text,
  validity_days integer check (validity_days is null or validity_days > 0),
  requires_certificate boolean not null default true,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index training_catalog_organization_name_unique
  on public.training_catalog (organization_id, lower(name));

alter table public.training_catalog enable row level security;

create policy "training catalog tenant select"
  on public.training_catalog for select
  using (organization_id = public.current_org_id() or public.is_nexus_admin());

create policy "training catalog tenant insert"
  on public.training_catalog for insert
  with check (organization_id = public.current_org_id() or public.is_nexus_admin());

create policy "training catalog tenant update"
  on public.training_catalog for update
  using (organization_id = public.current_org_id() or public.is_nexus_admin())
  with check (organization_id = public.current_org_id() or public.is_nexus_admin());

create policy "training catalog tenant delete"
  on public.training_catalog for delete
  using (organization_id = public.current_org_id() or public.is_nexus_admin());

grant select, insert, update, delete on table public.training_catalog to authenticated;
