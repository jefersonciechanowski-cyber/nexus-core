begin;

-- Sensitive commercial and financial reads remain available to normal tenant
-- users under their existing policies. A Nexus platform admin may cross tenant
-- boundaries only with an AAL2 session.

drop policy if exists "nexus sales cross tenant admin read requires aal2" on public.nexus_sales;
create policy "nexus sales cross tenant admin read requires aal2"
on public.nexus_sales
as restrictive
for select
to authenticated
using (
  not public.is_nexus_admin()
  or organization_id = public.current_org_id()
  or public.is_nexus_admin_aal2()
);

drop policy if exists "product access cross tenant admin read requires aal2" on public.organization_product_access;
create policy "product access cross tenant admin read requires aal2"
on public.organization_product_access
as restrictive
for select
to authenticated
using (
  not public.is_nexus_admin()
  or organization_id = public.current_org_id()
  or public.is_nexus_admin_aal2()
);

drop policy if exists "payment checkouts cross tenant admin read requires aal2" on public.nexus_payment_checkouts;
create policy "payment checkouts cross tenant admin read requires aal2"
on public.nexus_payment_checkouts
as restrictive
for select
to authenticated
using (
  not public.is_nexus_admin()
  or organization_id = public.current_org_id()
  or public.is_nexus_admin_aal2()
);

drop policy if exists "payments cross tenant admin read requires aal2" on public.nexus_payments;
create policy "payments cross tenant admin read requires aal2"
on public.nexus_payments
as restrictive
for select
to authenticated
using (
  not public.is_nexus_admin()
  or organization_id = public.current_org_id()
  or public.is_nexus_admin_aal2()
);

drop policy if exists "payment webhook events admin read requires aal2" on public.nexus_payment_webhook_events;
create policy "payment webhook events admin read requires aal2"
on public.nexus_payment_webhook_events
as restrictive
for select
to authenticated
using (
  not public.is_nexus_admin()
  or public.is_nexus_admin_aal2()
);

commit;
