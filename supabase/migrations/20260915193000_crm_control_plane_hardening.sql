begin;

-- Contas desativadas não podem continuar resolvendo organização ou poder global
-- através dos helpers usados pelas policies RLS antigas.
create or replace function public.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select profile.organization_id
  from public.profiles profile
  where profile.id = (select auth.uid())
    and profile.active = true
  limit 1
$$;

create or replace function public.is_nexus_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles profile
    where profile.id = (select auth.uid())
      and profile.active = true
      and profile.role = 'nexus_admin'::public.app_role
  )
$$;

revoke all on function public.current_org_id() from public, anon;
revoke all on function public.is_nexus_admin() from public, anon;
grant execute on function public.current_org_id() to authenticated;
grant execute on function public.is_nexus_admin() to authenticated;

-- O CRM possui um control plane remoto próprio. Alterações diretas por clientes
-- autenticados podem deixar Nexus Central e Nexus CRM divergentes. Service role
-- continua livre para webhooks, checkout e Edge Functions server-side.
drop policy if exists "crm product access insert only server side" on public.organization_product_access;
create policy "crm product access insert only server side"
  on public.organization_product_access
  as restrictive
  for insert
  to authenticated
  with check (
    not exists (
      select 1
      from public.nexus_products product
      where product.id = organization_product_access.product_id
        and product.code = 'crm'
    )
  );

drop policy if exists "crm product access update only server side" on public.organization_product_access;
create policy "crm product access update only server side"
  on public.organization_product_access
  as restrictive
  for update
  to authenticated
  using (
    not exists (
      select 1
      from public.nexus_products product
      where product.id = organization_product_access.product_id
        and product.code = 'crm'
    )
  )
  with check (
    not exists (
      select 1
      from public.nexus_products product
      where product.id = organization_product_access.product_id
        and product.code = 'crm'
    )
  );

drop policy if exists "crm product access delete only server side" on public.organization_product_access;
create policy "crm product access delete only server side"
  on public.organization_product_access
  as restrictive
  for delete
  to authenticated
  using (
    not exists (
      select 1
      from public.nexus_products product
      where product.id = organization_product_access.product_id
        and product.code = 'crm'
    )
  );

comment on function public.current_org_id() is
  'Resolve a organização apenas para perfil autenticado e ativo.';
comment on function public.is_nexus_admin() is
  'Retorna true somente para perfil Nexus admin autenticado e ativo.';

commit;
