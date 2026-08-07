create table public.exam_catalog (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  measurement_unit text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index exam_catalog_organization_name_unique
  on public.exam_catalog (organization_id, lower(name));

alter table public.exam_catalog enable row level security;

create policy "exam catalog tenant select"
  on public.exam_catalog for select
  using (organization_id = public.current_org_id() or public.is_nexus_admin());

create policy "exam catalog tenant insert"
  on public.exam_catalog for insert
  with check (organization_id = public.current_org_id() or public.is_nexus_admin());

create policy "exam catalog tenant update"
  on public.exam_catalog for update
  using (organization_id = public.current_org_id() or public.is_nexus_admin())
  with check (organization_id = public.current_org_id() or public.is_nexus_admin());

create policy "exam catalog tenant delete"
  on public.exam_catalog for delete
  using (organization_id = public.current_org_id() or public.is_nexus_admin());

grant select, insert, update, delete on table public.exam_catalog to authenticated;
