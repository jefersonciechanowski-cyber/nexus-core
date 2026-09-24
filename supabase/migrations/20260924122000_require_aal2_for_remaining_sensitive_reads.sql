begin;

-- Remaining sensitive cross-tenant reads require AAL2 for Nexus platform admins.
-- Normal tenant-scoped access for authenticated users remains unchanged.

-- Straight organization-scoped tables.
drop policy if exists "company_documents cross tenant admin read requires aal2" on public.company_documents;
create policy "company_documents cross tenant admin read requires aal2"
on public.company_documents
as restrictive
for select
to authenticated
using (
  not public.is_nexus_admin()
  or organization_id = public.current_org_id()
  or public.is_nexus_admin_aal2()
);

drop policy if exists "epi_deliveries cross tenant admin read requires aal2" on public.epi_deliveries;
create policy "epi_deliveries cross tenant admin read requires aal2"
on public.epi_deliveries
as restrictive
for select
to authenticated
using (
  not public.is_nexus_admin()
  or organization_id = public.current_org_id()
  or public.is_nexus_admin_aal2()
);

drop policy if exists "epi_purchases cross tenant admin read requires aal2" on public.epi_purchases;
create policy "epi_purchases cross tenant admin read requires aal2"
on public.epi_purchases
as restrictive
for select
to authenticated
using (
  not public.is_nexus_admin()
  or organization_id = public.current_org_id()
  or public.is_nexus_admin_aal2()
);

drop policy if exists "notification_alert_states cross tenant admin read requires aal2" on public.notification_alert_states;
create policy "notification_alert_states cross tenant admin read requires aal2"
on public.notification_alert_states
as restrictive
for select
to authenticated
using (
  not public.is_nexus_admin()
  or organization_id = public.current_org_id()
  or public.is_nexus_admin_aal2()
);

drop policy if exists "notification_delivery_logs cross tenant admin read requires aal2" on public.notification_delivery_logs;
create policy "notification_delivery_logs cross tenant admin read requires aal2"
on public.notification_delivery_logs
as restrictive
for select
to authenticated
using (
  not public.is_nexus_admin()
  or organization_id = public.current_org_id()
  or public.is_nexus_admin_aal2()
);

drop policy if exists "notification_email_preferences cross tenant admin read requires aal2" on public.notification_email_preferences;
create policy "notification_email_preferences cross tenant admin read requires aal2"
on public.notification_email_preferences
as restrictive
for select
to authenticated
using (
  not public.is_nexus_admin()
  or organization_id = public.current_org_id()
  or public.is_nexus_admin_aal2()
);

drop policy if exists "regulatory_inspections cross tenant admin read requires aal2" on public.regulatory_inspections;
create policy "regulatory_inspections cross tenant admin read requires aal2"
on public.regulatory_inspections
as restrictive
for select
to authenticated
using (
  not public.is_nexus_admin()
  or organization_id = public.current_org_id()
  or public.is_nexus_admin_aal2()
);

drop policy if exists "regulatory_requirements cross tenant admin read requires aal2" on public.regulatory_requirements;
create policy "regulatory_requirements cross tenant admin read requires aal2"
on public.regulatory_requirements
as restrictive
for select
to authenticated
using (
  not public.is_nexus_admin()
  or organization_id = public.current_org_id()
  or public.is_nexus_admin_aal2()
);

drop policy if exists "units cross tenant admin read requires aal2" on public.units;
create policy "units cross tenant admin read requires aal2"
on public.units
as restrictive
for select
to authenticated
using (
  not public.is_nexus_admin()
  or organization_id = public.current_org_id()
  or public.is_nexus_admin_aal2()
);



-- Organizations: current organization remains readable in AAL1.
drop policy if exists "organizations cross tenant admin read requires aal2" on public.organizations;
create policy "organizations cross tenant admin read requires aal2"
on public.organizations
as restrictive
for select
to authenticated
using (
  not public.is_nexus_admin()
  or id = public.current_org_id()
  or public.is_nexus_admin_aal2()
);

-- Organization memberships: preserve own/current-tenant reads; global traversal needs AAL2.
drop policy if exists "organization memberships cross tenant admin read requires aal2" on public.organization_memberships;
create policy "organization memberships cross tenant admin read requires aal2"
on public.organization_memberships
as restrictive
for select
to authenticated
using (
  not public.is_nexus_admin()
  or user_id = auth.uid()
  or organization_id = public.current_org_id()
  or public.is_nexus_admin_aal2()
);

-- AI usage/access: preserve the admin's own records; reading other users requires AAL2.
drop policy if exists "ai usage cross user admin read requires aal2" on public.nexus_ai_usage_events;
create policy "ai usage cross user admin read requires aal2"
on public.nexus_ai_usage_events
as restrictive
for select
to authenticated
using (
  not public.is_nexus_admin()
  or user_id = auth.uid()
  or organization_id = public.current_org_id()
  or public.is_nexus_admin_aal2()
);

drop policy if exists "ai user access cross user admin read requires aal2" on public.nexus_ai_user_access;
create policy "ai user access cross user admin read requires aal2"
on public.nexus_ai_user_access
as restrictive
for select
to authenticated
using (
  not public.is_nexus_admin()
  or user_id = auth.uid()
  or organization_id = public.current_org_id()
  or public.is_nexus_admin_aal2()
);

-- Nexus account structures: preserve reads through the caller's own account membership.
drop policy if exists "nexus accounts cross account admin read requires aal2" on public.nexus_accounts;
create policy "nexus accounts cross account admin read requires aal2"
on public.nexus_accounts
as restrictive
for select
to authenticated
using (
  not public.is_nexus_admin()
  or exists (
    select 1
    from public.nexus_account_users account_user
    where account_user.account_id = nexus_accounts.id
      and account_user.user_id = auth.uid()
      and account_user.active = true
  )
  or public.is_nexus_admin_aal2()
);

drop policy if exists "nexus account organizations cross account admin read requires aal2" on public.nexus_account_organizations;
create policy "nexus account organizations cross account admin read requires aal2"
on public.nexus_account_organizations
as restrictive
for select
to authenticated
using (
  not public.is_nexus_admin()
  or organization_id = public.current_org_id()
  or exists (
    select 1
    from public.nexus_account_users account_user
    where account_user.account_id = nexus_account_organizations.account_id
      and account_user.user_id = auth.uid()
      and account_user.active = true
  )
  or public.is_nexus_admin_aal2()
);

drop policy if exists "nexus account users cross account admin read requires aal2" on public.nexus_account_users;
create policy "nexus account users cross account admin read requires aal2"
on public.nexus_account_users
as restrictive
for select
to authenticated
using (
  not public.is_nexus_admin()
  or user_id = auth.uid()
  or public.is_nexus_admin_aal2()
);

commit;
