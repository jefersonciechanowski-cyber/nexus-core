-- Read-only recovery comparison. Run on a verified isolated restored backup.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH counts AS (
 SELECT 'organizations'::text AS metric, count(*)::bigint AS total FROM public.organizations
 UNION ALL SELECT 'profiles', count(*) FROM public.profiles
 UNION ALL SELECT 'memberships', count(*) FROM public.organization_memberships
 UNION ALL SELECT 'accounts', count(*) FROM public.nexus_accounts
 UNION ALL SELECT 'account_organizations', count(*) FROM public.nexus_account_organizations
 UNION ALL SELECT 'account_users', count(*) FROM public.nexus_account_users
 UNION ALL SELECT 'product_access', count(*) FROM public.organization_product_access
 UNION ALL SELECT 'payment_checkouts', count(*) FROM public.nexus_payment_checkouts
 UNION ALL SELECT 'payments', count(*) FROM public.nexus_payments
), relationships AS (
 SELECT 'profiles_org_missing'::text AS metric, count(*)::bigint AS total FROM public.profiles p WHERE p.organization_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id=p.organization_id)
 UNION ALL SELECT 'membership_org_missing', count(*) FROM public.organization_memberships m WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id=m.organization_id)
 UNION ALL SELECT 'account_org_link_missing', count(*) FROM public.nexus_account_organizations x WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id=x.organization_id) OR NOT EXISTS (SELECT 1 FROM public.nexus_accounts a WHERE a.id=x.account_id)
 UNION ALL SELECT 'account_user_link_missing', count(*) FROM public.nexus_account_users x WHERE NOT EXISTS (SELECT 1 FROM public.nexus_accounts a WHERE a.id=x.account_id) OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id=x.user_id)
 UNION ALL SELECT 'product_org_missing', count(*) FROM public.organization_product_access x WHERE NOT EXISTS (SELECT 1 FROM public.organizations o WHERE o.id=x.organization_id)
 UNION ALL SELECT 'access_ref_missing', count(*) FROM public.nexus_payments x WHERE x.access_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.organization_product_access a WHERE a.id=x.access_id)
), states AS (
 SELECT 'access_status:'||coalesce(access_status,'<null>') AS metric, count(*)::bigint AS total FROM public.organization_product_access GROUP BY access_status
 UNION ALL SELECT 'subscription_status:'||coalesce(subscription_status,'<null>'), count(*) FROM public.organization_product_access GROUP BY subscription_status
)
SELECT 'count' AS type, metric, total FROM counts
UNION ALL SELECT 'link_integrity',metric,total FROM relationships
UNION ALL SELECT 'state',metric,total FROM states
ORDER BY type,metric;
COMMIT;
