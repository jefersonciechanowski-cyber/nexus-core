-- Commercial readiness Part 2: require MFA (AAL2) for critical Nexus admin mutations.

create or replace function public.is_nexus_admin_aal2()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.active = true
        and p.role = 'nexus_admin'::public.app_role
    );
$$;

revoke all on function public.is_nexus_admin_aal2() from public;
revoke all on function public.is_nexus_admin_aal2() from anon;
grant execute on function public.is_nexus_admin_aal2() to authenticated;
grant execute on function public.is_nexus_admin_aal2() to service_role;

-- CRM contracts: authenticated writes to CRM rows require an AAL2 Nexus admin.
drop policy if exists "crm access insert requires nexus admin aal2" on public.organization_product_access;
create policy "crm access insert requires nexus admin aal2"
on public.organization_product_access
as restrictive
for insert
to authenticated
with check (
  not exists (
    select 1
    from public.nexus_products p
    where p.id = organization_product_access.product_id
      and p.code = 'crm'
  )
  or public.is_nexus_admin_aal2()
);

drop policy if exists "crm access update requires nexus admin aal2" on public.organization_product_access;
create policy "crm access update requires nexus admin aal2"
on public.organization_product_access
as restrictive
for update
to authenticated
using (
  not exists (
    select 1
    from public.nexus_products p
    where p.id = organization_product_access.product_id
      and p.code = 'crm'
  )
  or public.is_nexus_admin_aal2()
)
with check (
  not exists (
    select 1
    from public.nexus_products p
    where p.id = organization_product_access.product_id
      and p.code = 'crm'
  )
  or public.is_nexus_admin_aal2()
);

drop policy if exists "crm access delete requires nexus admin aal2" on public.organization_product_access;
create policy "crm access delete requires nexus admin aal2"
on public.organization_product_access
as restrictive
for delete
to authenticated
using (
  not exists (
    select 1
    from public.nexus_products p
    where p.id = organization_product_access.product_id
      and p.code = 'crm'
  )
  or public.is_nexus_admin_aal2()
);

-- Commercial control-plane tables: reads remain unchanged, mutations require AAL2.
drop policy if exists "nexus products insert requires admin aal2" on public.nexus_products;
create policy "nexus products insert requires admin aal2"
on public.nexus_products as restrictive for insert to authenticated
with check (public.is_nexus_admin_aal2());

drop policy if exists "nexus products update requires admin aal2" on public.nexus_products;
create policy "nexus products update requires admin aal2"
on public.nexus_products as restrictive for update to authenticated
using (public.is_nexus_admin_aal2())
with check (public.is_nexus_admin_aal2());

drop policy if exists "nexus products delete requires admin aal2" on public.nexus_products;
create policy "nexus products delete requires admin aal2"
on public.nexus_products as restrictive for delete to authenticated
using (public.is_nexus_admin_aal2());

drop policy if exists "nexus plans insert requires admin aal2" on public.nexus_plans;
create policy "nexus plans insert requires admin aal2"
on public.nexus_plans as restrictive for insert to authenticated
with check (public.is_nexus_admin_aal2());

drop policy if exists "nexus plans update requires admin aal2" on public.nexus_plans;
create policy "nexus plans update requires admin aal2"
on public.nexus_plans as restrictive for update to authenticated
using (public.is_nexus_admin_aal2())
with check (public.is_nexus_admin_aal2());

drop policy if exists "nexus plans delete requires admin aal2" on public.nexus_plans;
create policy "nexus plans delete requires admin aal2"
on public.nexus_plans as restrictive for delete to authenticated
using (public.is_nexus_admin_aal2());

drop policy if exists "nexus sales insert requires admin aal2" on public.nexus_sales;
create policy "nexus sales insert requires admin aal2"
on public.nexus_sales as restrictive for insert to authenticated
with check (public.is_nexus_admin_aal2());

drop policy if exists "nexus sales update requires admin aal2" on public.nexus_sales;
create policy "nexus sales update requires admin aal2"
on public.nexus_sales as restrictive for update to authenticated
using (public.is_nexus_admin_aal2())
with check (public.is_nexus_admin_aal2());

drop policy if exists "nexus sales delete requires admin aal2" on public.nexus_sales;
create policy "nexus sales delete requires admin aal2"
on public.nexus_sales as restrictive for delete to authenticated
using (public.is_nexus_admin_aal2());

drop policy if exists "nexus payments insert requires admin aal2" on public.nexus_payments;
create policy "nexus payments insert requires admin aal2"
on public.nexus_payments as restrictive for insert to authenticated
with check (public.is_nexus_admin_aal2());

drop policy if exists "nexus payments update requires admin aal2" on public.nexus_payments;
create policy "nexus payments update requires admin aal2"
on public.nexus_payments as restrictive for update to authenticated
using (public.is_nexus_admin_aal2())
with check (public.is_nexus_admin_aal2());

drop policy if exists "nexus payments delete requires admin aal2" on public.nexus_payments;
create policy "nexus payments delete requires admin aal2"
on public.nexus_payments as restrictive for delete to authenticated
using (public.is_nexus_admin_aal2());

drop policy if exists "nexus payment checkouts insert requires admin aal2" on public.nexus_payment_checkouts;
create policy "nexus payment checkouts insert requires admin aal2"
on public.nexus_payment_checkouts as restrictive for insert to authenticated
with check (public.is_nexus_admin_aal2());

drop policy if exists "nexus payment checkouts update requires admin aal2" on public.nexus_payment_checkouts;
create policy "nexus payment checkouts update requires admin aal2"
on public.nexus_payment_checkouts as restrictive for update to authenticated
using (public.is_nexus_admin_aal2())
with check (public.is_nexus_admin_aal2());

drop policy if exists "nexus payment checkouts delete requires admin aal2" on public.nexus_payment_checkouts;
create policy "nexus payment checkouts delete requires admin aal2"
on public.nexus_payment_checkouts as restrictive for delete to authenticated
using (public.is_nexus_admin_aal2());
