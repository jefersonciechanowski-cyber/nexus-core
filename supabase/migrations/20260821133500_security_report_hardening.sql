-- Security hardening from the external review dated 2026-08-21.
-- Goals: fail closed for anonymous access, narrow legacy RLS roles to authenticated,
-- protect Nexus-admin context with recent MFA, and gate sensitive service-role writes.

-- 1) Narrow legacy policies that were written TO public.
alter policy "tenant select" on public.control_matrix_rules to authenticated;
alter policy "tenant select" on public.employees to authenticated;
alter policy "epi catalog tenant select" on public.epi_catalog to authenticated;
alter policy "epi deliveries tenant select" on public.epi_deliveries to authenticated;
alter policy "epi purchases tenant select" on public.epi_purchases to authenticated;
alter policy "exam catalog tenant select" on public.exam_catalog to authenticated;
alter policy "exam evaluation rules select" on public.exam_evaluation_rules to authenticated;
alter policy "tenant select" on public.exam_records to authenticated;
alter policy "tenant select" on public.job_roles to authenticated;
alter policy "occurrence types tenant select" on public.occurrence_types to authenticated;
alter policy "tenant select" on public.occurrences to authenticated;
alter policy "update own organization" on public.organizations to authenticated;
alter policy "read profiles in organization" on public.profiles to authenticated;
alter policy "sector exam requirements tenant select" on public.sector_exam_requirements to authenticated;
alter policy "tenant select" on public.sectors to authenticated;
alter policy "training catalog tenant select" on public.training_catalog to authenticated;
alter policy "tenant select" on public.training_records to authenticated;
alter policy "tenant select" on public.units to authenticated;

-- Historical exam records are append/update only from the app. Removal is not exposed.
drop policy if exists "tenant delete" on public.exam_records;
revoke delete on public.exam_records from authenticated;

-- 2) Anonymous browser clients must not reach the application schema directly.
revoke usage on schema public from anon;
revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
revoke execute on all functions in schema public from public;

-- Future objects fail closed until a migration explicitly grants the minimum access.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated;

-- 3) Nexus-admin tenant context only exists after recent MFA.
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p.role = 'nexus_admin'::public.app_role and not public.is_nexus_admin() then null
    else p.organization_id
  end
  from public.profiles p
  where p.id = auth.uid()
    and p.active = true
$$;

-- Password-only admin sessions can read only their own profile so the UI can route
-- the user into the MFA challenge; this policy does not open tenant data.
drop policy if exists "read own profile for authentication" on public.profiles;
create policy "read own profile for authentication"
on public.profiles
for select
to authenticated
using (id = auth.uid());

create or replace function public.enforce_nexus_admin_recent_mfa_on_profile_context_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null
     and auth.uid() = old.id
     and old.role = 'nexus_admin'::public.app_role
     and (new.organization_id is distinct from old.organization_id or new.role is distinct from old.role)
     and not public.is_nexus_admin() then
    raise exception 'A verificação em duas etapas do administrador Nexus é obrigatória.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_nexus_admin_recent_mfa_on_profile_context_change() from public, anon, authenticated;

drop trigger if exists profiles_require_recent_admin_mfa on public.profiles;
create trigger profiles_require_recent_admin_mfa
before update of organization_id, role on public.profiles
for each row execute function public.enforce_nexus_admin_recent_mfa_on_profile_context_change();

create or replace function public.enforce_nexus_admin_recent_mfa_on_organization_create()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is not null
     and exists (
       select 1 from public.profiles p
       where p.id = auth.uid() and p.active = true and p.role = 'nexus_admin'::public.app_role
     )
     and not public.is_nexus_admin() then
    raise exception 'A verificação em duas etapas do administrador Nexus é obrigatória.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_nexus_admin_recent_mfa_on_organization_create() from public, anon, authenticated;

drop trigger if exists organizations_require_recent_admin_mfa on public.organizations;
create trigger organizations_require_recent_admin_mfa
before insert on public.organizations
for each row execute function public.enforce_nexus_admin_recent_mfa_on_organization_create();

-- 4) Service-role workflows that act for an admin must prove a recent AAL2 session.
-- Using the latest session prevents a newer password-only (aal1) session from piggybacking
-- on an older MFA session. The two-hour window matches the Central Nexus admin policy.
create or replace function public.has_recent_nexus_admin_mfa_session(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  with latest_session as (
    select s.aal::text as aal, s.factor_id, s.created_at
    from auth.sessions s
    where s.user_id = p_user_id
      and (s.not_after is null or s.not_after > now())
    order by s.created_at desc
    limit 1
  )
  select exists (
    select 1
    from public.profiles p
    where p.id = p_user_id
      and p.active = true
      and p.role = 'nexus_admin'::public.app_role
  )
  and exists (
    select 1
    from latest_session s
    where s.aal = 'aal2'
      and s.factor_id is not null
      and s.created_at >= now() - interval '2 hours'
  )
$$;
revoke all on function public.has_recent_nexus_admin_mfa_session(uuid) from public, anon, authenticated;
grant execute on function public.has_recent_nexus_admin_mfa_session(uuid) to service_role;

create or replace function public.enforce_recent_nexus_admin_mfa_on_account_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.created_by is not null
     and exists (
       select 1 from public.profiles p
       where p.id = new.created_by and p.active = true and p.role = 'nexus_admin'::public.app_role
     )
     and not public.has_recent_nexus_admin_mfa_session(new.created_by) then
    raise exception 'Recent Nexus admin MFA is required to create an account' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_recent_nexus_admin_mfa_on_account_insert() from public, anon, authenticated;

drop trigger if exists nexus_accounts_require_recent_admin_mfa on public.nexus_accounts;
create trigger nexus_accounts_require_recent_admin_mfa
before insert on public.nexus_accounts
for each row execute function public.enforce_recent_nexus_admin_mfa_on_account_insert();

create or replace function public.enforce_recent_nexus_admin_mfa_on_ai_usage_insert()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.user_id is not null
     and exists (
       select 1 from public.profiles p
       where p.id = new.user_id and p.active = true and p.role = 'nexus_admin'::public.app_role
     )
     and not public.has_recent_nexus_admin_mfa_session(new.user_id) then
    raise exception 'Recent Nexus admin MFA is required for Nexus AI' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.enforce_recent_nexus_admin_mfa_on_ai_usage_insert() from public, anon, authenticated;

drop trigger if exists nexus_ai_usage_require_recent_admin_mfa on public.nexus_ai_usage_events;
create trigger nexus_ai_usage_require_recent_admin_mfa
before insert on public.nexus_ai_usage_events
for each row execute function public.enforce_recent_nexus_admin_mfa_on_ai_usage_insert();
