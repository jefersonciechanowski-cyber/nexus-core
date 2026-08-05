create extension if not exists pgcrypto;
create type public.app_role as enum ('nexus_admin','org_admin','sst_manager','sst_technician','hr','director','viewer');
create table public.organizations (id uuid primary key default gen_random_uuid(), name text not null, slug text unique not null, status text not null default 'active', created_at timestamptz not null default now());
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, organization_id uuid references public.organizations(id), full_name text not null, role public.app_role not null default 'viewer', active boolean not null default true, created_at timestamptz not null default now());
create table public.units (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, name text not null, created_at timestamptz not null default now());
create table public.sectors (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, unit_id uuid not null references public.units(id) on delete cascade, name text not null, created_at timestamptz not null default now());
create table public.job_roles (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, name text not null, created_at timestamptz not null default now());
create table public.employees (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, unit_id uuid references public.units(id), sector_id uuid references public.sectors(id), job_role_id uuid references public.job_roles(id), full_name text not null, shift text, active boolean not null default true, created_at timestamptz not null default now());
create table public.control_matrix_rules (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, sector_id uuid not null references public.sectors(id) on delete cascade, job_role_id uuid references public.job_roles(id), requirement_type text not null check (requirement_type in ('exam','training','epi','document','risk')), requirement_name text not null, validity_days integer, effective_from date not null default current_date, effective_to date, created_at timestamptz not null default now());
create table public.training_records (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, employee_id uuid not null references public.employees(id) on delete cascade, training_name text not null, completed_at date not null, expires_at date, certificate_path text, created_at timestamptz not null default now());
create table public.epi_catalog (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, name text not null, ca_code text, active boolean not null default true, created_at timestamptz not null default now());
create table public.epi_purchases (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, epi_id uuid not null references public.epi_catalog(id), quantity integer not null check(quantity>0), purchase_date date not null, technical_responsible text not null, invoice_ref text, created_at timestamptz not null default now());
create table public.epi_deliveries (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, employee_id uuid not null references public.employees(id), epi_id uuid not null references public.epi_catalog(id), sector_id uuid not null references public.sectors(id), delivered_at date not null, replacement_due_at date, returned_at date, created_at timestamptz not null default now());
create table public.exam_records (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, employee_id uuid not null references public.employees(id), exam_name text not null, collected_at date not null, value numeric, status text, created_at timestamptz not null default now());
create table public.occurrences (id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade, employee_id uuid references public.employees(id), occurrence_type text not null, severity text not null, description text not null, occurred_at date not null, status text not null default 'open', created_at timestamptz not null default now());
create table public.audit_logs (id bigint generated always as identity primary key, organization_id uuid references public.organizations(id), user_id uuid references auth.users(id), action text not null, entity text not null, entity_id text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now());

create or replace function public.current_org_id() returns uuid language sql stable security definer set search_path=public as $$ select organization_id from public.profiles where id=auth.uid() $$;
create or replace function public.is_nexus_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='nexus_admin') $$;

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.units enable row level security;
alter table public.sectors enable row level security;
alter table public.job_roles enable row level security;
alter table public.employees enable row level security;
alter table public.control_matrix_rules enable row level security;
alter table public.training_records enable row level security;
alter table public.epi_catalog enable row level security;
alter table public.epi_purchases enable row level security;
alter table public.epi_deliveries enable row level security;
alter table public.exam_records enable row level security;
alter table public.occurrences enable row level security;
alter table public.audit_logs enable row level security;

create policy "read own organization" on public.organizations for select using (id=public.current_org_id() or public.is_nexus_admin());
create policy "read profiles in organization" on public.profiles for select using (organization_id=public.current_org_id() or public.is_nexus_admin());

-- Política padrão multi-tenant para tabelas com organization_id.
do $$ declare t text; begin
  foreach t in array array['units','sectors','job_roles','employees','control_matrix_rules','training_records','epi_catalog','epi_purchases','epi_deliveries','exam_records','occurrences','audit_logs'] loop
    execute format('create policy "tenant select" on public.%I for select using (organization_id=public.current_org_id() or public.is_nexus_admin())',t);
    execute format('create policy "tenant insert" on public.%I for insert with check (organization_id=public.current_org_id() or public.is_nexus_admin())',t);
    execute format('create policy "tenant update" on public.%I for update using (organization_id=public.current_org_id() or public.is_nexus_admin()) with check (organization_id=public.current_org_id() or public.is_nexus_admin())',t);
    execute format('create policy "tenant delete" on public.%I for delete using (organization_id=public.current_org_id() or public.is_nexus_admin())',t);
  end loop;
end $$;
