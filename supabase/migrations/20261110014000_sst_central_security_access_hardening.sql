-- SST + Nexus Central emergency security hardening.
-- Does not delete any customer records, change plans, create payments, or grant new paid access.
-- Membership revocations and expired pilot access are enforced by the database, not only UI.
begin;

create schema if not exists private;

-- The previous current_org_id trusted an active profile even after the
-- corresponding organization membership was revoked. Every tenant RLS policy
-- using current_org_id depends on this invariant.
create or replace function public.current_org_id()
returns uuid language sql stable security definer
set search_path = ''
as $$
  select p.organization_id
  from public.profiles p
  join public.organization_memberships m
    on m.user_id=p.id and m.organization_id=p.organization_id and m.active=true
  join public.organizations o
    on o.id=p.organization_id and o.status='active'
  where p.id=(select auth.uid()) and p.active=true
  limit 1
$$;

-- Private predicate: it is NOT exposed as a REST RPC. Admin AAL2 is allowed
-- operational support access after a client expires, but normal clients are
-- denied direct REST & Storage access when their SST contract is not valid.
create or replace function private.sst_operational_access_allowed(p_org uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
 select coalesce(public.is_nexus_admin_aal2(),false)
    or (
      p_org is not null
      and p_org = public.current_org_id()
      and exists (
        select 1
        from public.profiles p
        join public.organization_memberships m
          on m.user_id=p.id and m.organization_id=p.organization_id and m.active=true
        join public.organizations o
          on o.id=p.organization_id and o.status='active'
        join public.organization_product_access a
          on a.organization_id=p.organization_id
        join public.nexus_products product
          on product.id=a.product_id and product.code='sst' and product.status='active'
        where p.id=(select auth.uid()) and p.active=true
          and p.organization_id=p_org and a.access_status='active'
          and (
            (a.subscription_status='trial'
              and a.renews_at is not null and a.renews_at >= current_date)
            or
            (a.subscription_status='active'
              and a.billing_provider in ('asaas','stripe')
              and a.renews_at is not null
              and (
                (a.billing_mode='prepaid'
                 and a.renews_at >= current_date)
                or
                (a.billing_mode='recurring'
                 and a.provider_subscription_id is not null
                 and a.renews_at >= current_date - 7)
              ))
            or
            -- Preserve pre-existing migrated provider-linked contracts;
            -- no new legacy access is approved by this policy.
            (a.subscription_status='legacy'
              and a.provider_subscription_id is not null
              and a.provider_customer_id is not null
              and a.billing_provider in ('asaas','stripe'))
          )
      )
    )
$$;
revoke all on function private.sst_operational_access_allowed(uuid) from public,anon;
grant usage on schema private to authenticated;
grant execute on function private.sst_operational_access_allowed(uuid) to authenticated;

-- Always use restrictive guards so an existing permissive tenant or admin
-- SELECT policy cannot bypass the commercial SST entitlement.
do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'company_documents',
    'control_matrix_rules',
    'employee_documents',
    'employees',
    'epi_catalog',
    'epi_deliveries',
    'epi_purchases',
    'exam_catalog',
    'exam_records',
    'job_roles',
    'notification_alert_states',
    'notification_delivery_logs',
    'notification_email_preferences',
    'occurrence_code_counters',
    'occurrence_types',
    'occurrences',
    'regulatory_inspections',
    'regulatory_requirements',
    'sector_exam_requirements',
    'sectors',
    'training_catalog',
    'training_record_code_counters',
    'training_records',
    'units'
  ] loop
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name=v_table and column_name='organization_id'
    ) then
      raise exception 'Expected SST organization isolation column is missing: %',v_table;
    end if;
    execute format('drop policy if exists %I on public.%I','sst valid entitlement for operational access',v_table);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (private.sst_operational_access_allowed(organization_id)) with check (private.sst_operational_access_allowed(organization_id))',
      'sst valid entitlement for operational access',v_table);
  end loop;
end
$$;

-- Files are private, but previous Storage RLS checked only the organization
-- directory. A former customer could download and upload by calling the API
-- after the 15-day pilot expired.
drop policy if exists "sst valid entitlement for storage access" on storage.objects;
create policy "sst valid entitlement for storage access"
  on storage.objects as restrictive for all to authenticated
  using (
    bucket_id <> 'sst-documents'
    or (
      (storage.foldername(name))[1] = public.current_org_id()::text
      and private.sst_operational_access_allowed(public.current_org_id())
    )
    or public.is_nexus_admin_aal2()
  )
  with check (
    bucket_id <> 'sst-documents'
    or (
      (storage.foldername(name))[1] = public.current_org_id()::text
      and private.sst_operational_access_allowed(public.current_org_id())
    )
    or public.is_nexus_admin_aal2()
  );

-- A Nexus admin with only a password (AAL1) was allowed by the existing
-- general admin policy to update SST plans, status, or renewal dates.
-- Require MFA for every SST entitlement write, with original admin policy
-- still providing the permissive allow rule. Service-role billing bypasses RLS.
drop policy if exists "sst entitlement insert requires nexus admin aal2" on public.organization_product_access;
create policy "sst entitlement insert requires nexus admin aal2"
 on public.organization_product_access as restrictive for insert to authenticated
 with check (
  not exists (
   select 1 from public.nexus_products p
   where p.id=organization_product_access.product_id and p.code='sst'
  ) or public.is_nexus_admin_aal2()
 );

drop policy if exists "sst entitlement update requires nexus admin aal2" on public.organization_product_access;
create policy "sst entitlement update requires nexus admin aal2"
 on public.organization_product_access as restrictive for update to authenticated
 using (
  not exists (
   select 1 from public.nexus_products p
   where p.id=organization_product_access.product_id and p.code='sst'
  ) or public.is_nexus_admin_aal2()
 )
 with check (
  not exists (
   select 1 from public.nexus_products p
   where p.id=organization_product_access.product_id and p.code='sst'
  ) or public.is_nexus_admin_aal2()
 );

drop policy if exists "sst entitlement delete requires nexus admin aal2" on public.organization_product_access;
create policy "sst entitlement delete requires nexus admin aal2"
 on public.organization_product_access as restrictive for delete to authenticated
 using (
  not exists (
   select 1 from public.nexus_products p
   where p.id=organization_product_access.product_id and p.code='sst'
  ) or public.is_nexus_admin_aal2()
 );

commit;
