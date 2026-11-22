-- Nexus AI: exact aggregate-only Central snapshot, zero customer-level rows.
-- Security INVOKER: service_role only (Edge Function authenticates nexus_admin + MFA AAL2).
-- No names, contacts, messages, phone numbers, emails, addresses or payment IDs.
create or replace function public.nexus_ai_central_snapshot()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $snapshot$
  select jsonb_build_object(
    'source', 'nexus-core-central-control-plane',
    'collectedAt', now(),
    'coverage', jsonb_build_object(
      'centralOrganizations', true,
      'centralCommercialAccesses', true,
      'centralSupportRequests', true,
      'centralCommercialIntakes', true,
      'centralAiUsage', true,
      'crmOperationalUsers', false,
      'crmOperationalLeads', false,
      'crmSystemHealth', false,
      'agencyOperational', false,
      'sstOperational', false
    ),
    'organizations', (
      select jsonb_build_object(
        'total', count(*),
        'active', count(*) filter (where status = 'active'),
        'archived', count(*) filter (where status = 'archived')
      )
      from public.organizations
    ),
    'centralProjectProfiles', (
      select jsonb_build_object(
        'total', count(*),
        'active', count(*) filter (where active is true)
      )
      from public.profiles
    ),
    'products', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'code', x.code,
          'catalogStatus', x.catalog_status,
          'commercialAccessRecords', x.total_accesses,
          'activeCommercialAccesses', x.active_accesses,
          'suspendedCommercialAccesses', x.suspended_accesses,
          'trialSubscriptionRecords', x.trial_subscriptions,
          'courtesyCommercialAccesses', x.courtesy_accesses,
          'pendingCommercialCrmSync', x.pending_crm_sync
        ) order by x.code
      )
      from (
        select
          p.code,
          p.status as catalog_status,
          count(a.id) as total_accesses,
          count(a.id) filter (where a.access_status = 'active') as active_accesses,
          count(a.id) filter (where a.access_status = 'suspended') as suspended_accesses,
          count(a.id) filter (where a.subscription_status = 'trial') as trial_subscriptions,
          count(a.id) filter (where a.commercial_condition = 'courtesy') as courtesy_accesses,
          count(a.id) filter (
            where a.crm_sync_pending_since is not null
            or (
              a.crm_sync_revision is not null
              and (a.crm_sync_confirmed_revision is null or a.crm_sync_revision > a.crm_sync_confirmed_revision)
            )
          ) as pending_crm_sync
        from public.nexus_products p
        left join public.organization_product_access a on a.product_id = p.id
        group by p.id, p.code, p.status
      ) x
    ), '[]'::jsonb),
    'commercialIntakes', coalesce((
      select jsonb_agg(
        jsonb_build_object('productCode', x.code, 'recordStatus', x.sale_status, 'count', x.total)
        order by x.code, x.sale_status
      )
      from (
        select coalesce(p.code, 'unmapped') as code, s.sale_status, count(*) as total
        from public.nexus_sales s
        left join public.nexus_products p on p.id = s.product_id
        group by p.code, s.sale_status
      ) x
    ), '[]'::jsonb),
    'support', (
      select jsonb_build_object(
        'total', count(*),
        'openOrInProgress', count(*) filter (where status in ('open', 'in_progress'))
      )
      from public.support_requests
    ),
    'aiUsage30Days', (
      select jsonb_build_object(
        'requests', count(*),
        'successful', count(*) filter (where status = 'success'),
        'failed', count(*) filter (where status = 'error'),
        'recordedTokens', coalesce(sum(total_tokens), 0)
      )
      from public.nexus_ai_usage_events
      where created_at >= now() - interval '30 days'
    ),
    'limitations', jsonb_build_array(
      'Contagens de acessos comerciais não representam usuários ativos ou logados dentro do CRM.',
      'Acesso comercial ativo não comprova disponibilidade técnica, estabilidade ou uso do CRM.',
      'A Central não fornece nesta consulta leads internos, conversas, ligações ou indicadores operacionais dos produtos.',
      'Registros comerciais podem incluir históricos de testes, vencidos e cortesias; não representam faturamento recebido.',
      'Não há integração operacional de leitura com Agency ou SST nesta versão.'
    )
  );
$snapshot$;

-- Default function EXECUTE is PUBLIC: explicitly revoke before allowing the server-only role.
revoke all on function public.nexus_ai_central_snapshot() from public, anon, authenticated;
grant execute on function public.nexus_ai_central_snapshot() to service_role;
comment on function public.nexus_ai_central_snapshot()
  is 'Aggregate-only Central control-plane evidence for MFA-protected Nexus AI Edge Function; service_role only.';
