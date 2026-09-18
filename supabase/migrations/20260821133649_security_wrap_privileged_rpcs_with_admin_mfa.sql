create or replace function public.admin_mfa_gate()
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
     and exists (
       select 1
       from public.profiles p
       where p.id = auth.uid()
         and p.active = true
         and (
           p.role <> 'nexus_admin'::public.app_role
           or public.is_nexus_admin()
         )
     );
$$;

revoke all on function public.admin_mfa_gate() from public, anon;
grant execute on function public.admin_mfa_gate() to authenticated;

alter function public.create_managed_organization(text,text,text) rename to create_managed_organization_core;
revoke all on function public.create_managed_organization_core(text,text,text) from public, anon, authenticated;

create function public.create_managed_organization(
  p_name text,
  p_registration_type text default null,
  p_registration_number text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.admin_mfa_gate() then
    raise exception 'Verificação administrativa em duas etapas obrigatória.' using errcode = '42501';
  end if;
  return public.create_managed_organization_core(p_name, p_registration_type, p_registration_number);
end;
$$;
revoke all on function public.create_managed_organization(text,text,text) from public, anon;
grant execute on function public.create_managed_organization(text,text,text) to authenticated;

alter function public.switch_organization(uuid) rename to switch_organization_core;
revoke all on function public.switch_organization_core(uuid) from public, anon, authenticated;

create function public.switch_organization(p_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.admin_mfa_gate() then
    raise exception 'Verificação administrativa em duas etapas obrigatória.' using errcode = '42501';
  end if;
  return public.switch_organization_core(p_organization_id);
end;
$$;
revoke all on function public.switch_organization(uuid) from public, anon;
grant execute on function public.switch_organization(uuid) to authenticated;

alter function public.get_my_nexus_account_summary() rename to get_my_nexus_account_summary_core;
revoke all on function public.get_my_nexus_account_summary_core() from public, anon, authenticated;

create function public.get_my_nexus_account_summary()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.admin_mfa_gate() then
    raise exception 'Verificação administrativa em duas etapas obrigatória.' using errcode = '42501';
  end if;
  return public.get_my_nexus_account_summary_core();
end;
$$;
revoke all on function public.get_my_nexus_account_summary() from public, anon;
grant execute on function public.get_my_nexus_account_summary() to authenticated;

alter function public.get_my_organizations() rename to get_my_organizations_core;
revoke all on function public.get_my_organizations_core() from public, anon, authenticated;

create function public.get_my_organizations()
returns table(
  organization_id uuid,
  organization_name text,
  organization_slug text,
  organization_status text,
  membership_role text,
  is_current boolean,
  relationship_type text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.admin_mfa_gate() then
    raise exception 'Verificação administrativa em duas etapas obrigatória.' using errcode = '42501';
  end if;
  return query select * from public.get_my_organizations_core();
end;
$$;
revoke all on function public.get_my_organizations() from public, anon;
grant execute on function public.get_my_organizations() to authenticated;
