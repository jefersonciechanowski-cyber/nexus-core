import { createClient } from 'npm:@supabase/supabase-js@2.112.3';

// Arquiva apenas cadastros sem usuários, dados de operação, pagamentos ou tenant CRM.
// Não exclui linhas: os registros de auditoria continuam preservados.
const MAX_BODY_BYTES = 4096;
const clean = (v: unknown, limit = 250) => String(v ?? '').trim().slice(0, limit);
const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);

function allowedOrigin(request: Request): string | null {
  const raw = clean(request.headers.get('Origin'), 500);
  if (!raw) return 'https://nexuscore.app.br';
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const official = url.protocol === 'https:' &&
      ['nexuscore.app.br', 'www.nexuscore.app.br', 'central.nexuscore.app.br'].includes(host);
    const preview = url.protocol === 'https:' && host.endsWith('.jefersonciechanowski.workers.dev');
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(host);
    return official || preview || local ? url.origin : null;
  } catch {
    return null;
  }
}

function headers(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  };
}

// Tabelas com conteúdo real. Audit logs e configuração vazia são retidos,
// e não bloqueiam o arquivamento de um cadastro de teste.
const protectedTables = [
  'profiles', 'organization_memberships', 'nexus_payments',
  'nexus_payment_checkouts', 'nexus_sales', 'support_requests',
  'employees', 'units', 'company_documents', 'control_matrix_rules',
  'epi_catalog', 'epi_deliveries', 'epi_purchases',
  'exam_catalog', 'exam_records', 'job_roles',
  'occurrences', 'occurrence_types', 'regulatory_inspections',
  'regulatory_requirements', 'sector_exam_requirements',
  'sectors', 'training_catalog', 'training_records',
];

Deno.serve(async (request: Request) => {
  const origin = allowedOrigin(request);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: headers(origin || 'https://nexuscore.app.br'),
  });
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: origin ? 204 : 403, headers: headers(origin || 'https://nexuscore.app.br') });
  }
  if (!origin) return json({ error: 'Origem não autorizada.' }, 403);
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);
  if (Number(request.headers.get('content-length') || 0) > MAX_BODY_BYTES) {
    return json({ error: 'Requisição muito grande.' }, 413);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json({ error: 'Requisição muito grande.' }, 413);
  }

  let body: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('invalid');
    body = parsed;
  } catch {
    return json({ error: 'Dados inválidos.' }, 400);
  }
  const organizationId = clean(body.organizationId, 80);
  const confirmationName = clean(body.confirmationName, 160);
  if (!isUuid(organizationId) || !confirmationName) return json({ error: 'Confirmação inválida.' }, 400);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  if (!url || !anonKey || !serviceKey || !authorization) return json({ error: 'Serviço não configurado.' }, 503);
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
  });
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  const { data: { user }, error: userError } = await userClient.auth.getUser(token);
  if (userError || !user) return json({ error: 'Sessão inválida.' }, 401);
  const { data: mfa, error: mfaError } = await userClient.auth.mfa.getAuthenticatorAssuranceLevel(token);
  if (mfaError || mfa?.currentLevel !== 'aal2') {
    return json({ error: 'Confirme a autenticação em duas etapas para continuar.' }, 403);
  }
  const { data: profile, error: profileError } = await admin.from('profiles')
    .select('role,active').eq('id', user.id).maybeSingle();
  if (profileError || !profile?.active || profile.role !== 'nexus_admin') {
    return json({ error: 'Apenas administradores Nexus podem arquivar cadastros.' }, 403);
  }

  const { data: organization, error: orgError } = await admin.from('organizations')
    .select('id,name,email,status').eq('id', organizationId).maybeSingle();
  if (orgError) return json({ error: 'Falha ao verificar o cadastro.' }, 500);
  if (!organization) return json({ error: 'Cadastro não encontrado.' }, 404);
  if (organization.status === 'archived') return json({ error: 'Este cadastro já está arquivado.' }, 409);
  if (organization.status !== 'active' || confirmationName !== organization.name) {
    return json({ error: 'O nome de confirmação não confere ou o cadastro não está ativo.' }, 409);
  }

  const { data: accesses, error: accessError } = await admin.from('organization_product_access')
    .select('id,subscription_status,commercial_condition,contracted_price_cents,external_tenant_id,provider_customer_id,provider_subscription_id,crm_sync_revision')
    .eq('organization_id', organizationId);
  if (accessError) return json({ error: 'Falha ao verificar os acessos existentes.' }, 500);
  if ((accesses || []).some(a =>
    !['trial', 'legacy', 'cancelled'].includes(a.subscription_status) ||
    Number(a.contracted_price_cents || 0) > 0 ||
    !!a.external_tenant_id || !!a.provider_customer_id ||
    !!a.provider_subscription_id || Number(a.crm_sync_revision || 0) > 0
  )) {
    return json({
      error: 'Cadastro protegido: existe contrato comercial, cobrança ou tenant CRM. Suspenda/revise o cliente; não é possível remover automaticamente.',
    }, 409);
  }

  // Mesmo sem um perfil, um usuário Auth com este e-mail pode ter outro vínculo.
  // A remoção administrativa não pode apagar ou liberar esse login sem revisão humana.
  if (organization.email) {
    const targetEmail = organization.email.trim().toLowerCase();
    let page = 1;
    while (page <= 50) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error || !data) return json({ error: 'Não foi possível verificar os usuários de autenticação.' }, 500);
      if (data.users.some(u => (u.email || '').trim().toLowerCase() === targetEmail)) {
        return json({ error: 'Existe usuário de login com este e-mail. O cadastro deve ser revisado antes de ser removido.' }, 409);
      }
      if (data.users.length < 200) break;
      page++;
    }
    if (page > 50) return json({ error: 'A conferência de usuários excedeu o limite seguro.' }, 503);
  }

  const counts = await Promise.all(protectedTables.map(async table => {
    const { count, error } = await admin.from(table)
      .select('organization_id', { count: 'exact', head: true }).eq('organization_id', organizationId);
    return { table, count, error };
  }));
  if (counts.some(c => c.error || c.count === null)) {
    return json({ error: 'Não foi possível concluir a conferência dos dados. Nenhuma remoção realizada.' }, 500);
  }
  if (counts.some(c => Number(c.count) > 0)) {
    return json({ error: 'Cadastro com usuários ou dados reais vinculados. Para evitar perda de dados, a remoção foi bloqueada.' }, 409);
  }

  const { data: accountLinks, error: linkError } = await admin.from('nexus_account_organizations')
    .select('account_id').eq('organization_id', organizationId);
  const { data: billingAccounts, error: billingError } = await admin.from('nexus_accounts')
    .select('id').eq('billing_organization_id', organizationId);
  if (linkError || billingError) return json({ error: 'Não foi possível verificar as contas vinculadas.' }, 500);
  const accountIds = [...new Set([...(accountLinks || []).map(x => x.account_id), ...(billingAccounts || []).map(x => x.id)])];
  if (accountIds.length) {
    const [otherCompanies, accountUsers] = await Promise.all([
      admin.from('nexus_account_organizations').select('account_id', { head: true, count: 'exact' })
        .in('account_id', accountIds).neq('organization_id', organizationId),
      admin.from('nexus_account_users').select('account_id', { head: true, count: 'exact' })
        .in('account_id', accountIds),
    ]);
    if (otherCompanies.error || accountUsers.error) {
      return json({ error: 'Não foi possível verificar os usuários e empresas da conta.' }, 500);
    }
    if (Number(otherCompanies.count || 0) > 0 || Number(accountUsers.count || 0) > 0) {
      return json({ error: 'Cadastro vinculado a usuários ou a outra empresa. Remoção automática bloqueada.' }, 409);
    }
  }

  // Arquivar em vez de DELETE para preservar documentos e auditoria históricos.
  const when = new Date().toISOString();
  const { error: suspendError } = await admin.from('organization_product_access')
    .update({ access_status: 'suspended', updated_at: when }).eq('organization_id', organizationId);
  if (suspendError) return json({ error: 'Falha ao suspender os acessos. Nenhuma empresa foi arquivada.' }, 500);
  if (accountIds.length) {
    const { error: accountError } = await admin.from('nexus_accounts')
      .update({ status: 'suspended' }).in('id', accountIds);
    if (accountError) return json({ error: 'Falha ao suspender a conta; cadastro não foi arquivado.' }, 500);
  }
  const { data: updated, error: updateError } = await admin.from('organizations')
    .update({ status: 'archived' }).eq('id', organizationId).eq('status', 'active').select('id').maybeSingle();
  if (updateError || !updated) return json({ error: 'Não foi possível arquivar a empresa.' }, 500);

  const { error: auditError } = await admin.from('audit_logs').insert({
    organization_id: organizationId, user_id: user.id, action: 'archive_test_registration',
    entity: 'organizations', entity_id: organizationId,
    metadata: { email: organization.email, name: organization.name, archived_at: when, method: 'admin_safe_archive' },
  });
  if (auditError) console.error('[Nexus archive] Falha ao registrar evento de auditoria:', auditError.message);
  return json({ ok: true, organizationId, status: 'archived' });
});
