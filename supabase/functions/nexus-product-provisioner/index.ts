import { createClient } from 'npm:@supabase/supabase-js@2.112.3';

const clean = (value: unknown, size = 500) => String(value ?? '').trim().slice(0, size);
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

function retryAt(attempts: number) {
  const minutes = Math.min(60, 5 * Math.pow(2, Math.max(0, attempts - 1)));
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function safeEqual(left: string, right: string) {
  if (!left || left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

async function isAuthorized(admin: any, request: Request) {
  const workerToken = clean(Deno.env.get('NEXUS_PROVISIONER_TOKEN'), 1000);
  const suppliedWorkerToken = clean(request.headers.get('x-nexus-provisioner-token'), 1000);
  if (workerToken && safeEqual(workerToken, suppliedWorkerToken)) return true;

  const authorization = clean(request.headers.get('authorization'), 4096);
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return false;

  const { data: { user }, error } = await admin.auth.getUser(match[1]);
  if (error || !user?.id) return false;

  const { data: profile } = await admin
    .from('profiles')
    .select('role,active')
    .eq('id', user.id)
    .maybeSingle();

  return profile?.active === true && profile?.role === 'nexus_admin';
}

function integrationForProduct(code: string) {
  if (code === 'crm') {
    return {
      endpoint: clean(Deno.env.get('NEXUS_CRM_PROVISION_URL'), 1000),
      secret: clean(Deno.env.get('NEXUS_CRM_PROVISION_SECRET'), 2000),
    };
  }
  return { endpoint: '', secret: '' };
}

async function ownerContext(admin: any, organizationId: string) {
  const { data: profiles } = await admin
    .from('profiles')
    .select('id,full_name,role')
    .eq('organization_id', organizationId)
    .eq('active', true)
    .order('created_at', { ascending: true })
    .limit(20);

  const owner = (profiles || []).find((profile: any) => profile.role === 'org_admin') || profiles?.[0];
  if (!owner?.id) return { id: null, name: null, email: null };

  const { data } = await admin.auth.admin.getUserById(owner.id);
  return {
    id: owner.id,
    name: clean(owner.full_name, 140) || null,
    email: clean(data?.user?.email, 180).toLowerCase() || null,
  };
}

async function completeJob(admin: any, jobId: string, attempts: number) {
  const now = new Date().toISOString();
  await admin.from('nexus_product_provisioning_jobs').update({
    job_status: 'succeeded',
    attempts,
    last_error: null,
    processed_at: now,
    updated_at: now,
  }).eq('id', jobId);
}

async function processJob(admin: any, job: any) {
  const attempts = Number(job.attempts || 0) + 1;
  const now = new Date().toISOString();

  const { data: access, error: accessError } = await admin
    .from('organization_product_access')
    .select(`
      id,organization_id,product_id,plan_id,access_status,subscription_status,
      contracted_price_cents,contracted_currency,billing_mode,billing_cycle_months,
      starts_at,renews_at,external_tenant_id,external_launch_url,provisioned_at,
      organization:organizations(id,name,legal_name,trade_name,registration_number,email,phone),
      product:nexus_products(id,code,name,launch_url,provisioning_mode,status),
      plan:nexus_plans(id,code,name,seat_limit,status)
    `)
    .eq('id', job.access_id)
    .maybeSingle();

  if (accessError || !access?.id) throw new Error('Acesso Nexus não encontrado.');

  const product = Array.isArray(access.product) ? access.product[0] : access.product;
  const plan = Array.isArray(access.plan) ? access.plan[0] : access.plan;
  const organization = Array.isArray(access.organization) ? access.organization[0] : access.organization;

  if (!product?.code || product.provisioning_mode !== 'external') {
    await completeJob(admin, job.id, attempts);
    await admin.from('organization_product_access').update({
      provisioning_status: 'not_required',
      provisioning_error: null,
      updated_at: now,
    }).eq('id', access.id);
    return { jobId: job.id, accessId: access.id, status: 'not_required' };
  }

  if (product.status !== 'active') throw new Error('Produto Nexus está inativo.');
  if (!plan?.id || plan.status !== 'active') throw new Error('Plano comercial inválido para sincronização.');

  const entitled = access.access_status === 'active'
    && ['active','trial','legacy'].includes(access.subscription_status);

  // Não existe tenant e o acesso já não é elegível. Não há produto externo para
  // suspender; o job pode ser encerrado sem criar um ambiente desnecessário.
  if (!access.external_tenant_id && !entitled) {
    await completeJob(admin, job.id, attempts);
    return { jobId: job.id, accessId: access.id, status: 'skipped_not_entitled' };
  }

  const integration = integrationForProduct(product.code);
  if (!integration.endpoint || !integration.secret) {
    throw new Error(`Integração de provisionamento não configurada para ${product.code}.`);
  }

  const owner = await ownerContext(admin, access.organization_id);
  const event = entitled
    ? (access.external_tenant_id ? 'nexus.subscription.updated' : 'nexus.subscription.active')
    : 'nexus.subscription.suspended';

  const payload = {
    event,
    idempotencyKey: access.id,
    accessId: access.id,
    externalTenantId: access.external_tenant_id || null,
    entitlement: {
      allowed: entitled,
      accessStatus: access.access_status,
      subscriptionStatus: access.subscription_status,
    },
    organization: {
      centralId: access.organization_id,
      name: clean(organization?.name || organization?.trade_name || organization?.legal_name, 160),
      legalName: clean(organization?.legal_name, 180) || null,
      tradeName: clean(organization?.trade_name, 180) || null,
      registrationNumber: clean(organization?.registration_number, 30) || null,
      email: clean(organization?.email, 180).toLowerCase() || null,
      phone: clean(organization?.phone, 40) || null,
    },
    owner,
    product: {
      code: product.code,
      name: product.name,
    },
    plan: {
      id: plan.id,
      code: plan.code,
      name: plan.name,
      seatLimit: plan.seat_limit ?? null,
    },
    subscription: {
      status: access.subscription_status,
      startsAt: access.starts_at,
      renewsAt: access.renews_at,
      billingMode: access.billing_mode,
      billingCycleMonths: access.billing_cycle_months,
      contractedPriceCents: access.contracted_price_cents,
      currency: access.contracted_currency || 'BRL',
    },
  };

  const response = await fetch(integration.endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${integration.secret}`,
      'x-nexus-idempotency-key': access.id,
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.text();
  let result: Record<string, unknown> = {};
  try { result = raw ? JSON.parse(raw) : {}; } catch { result = {}; }

  if (!response.ok) {
    throw new Error(clean(result.error || result.message || `Provisionamento respondeu HTTP ${response.status}.`, 700));
  }

  const tenantId = clean(result.tenantId || result.tenant_id || access.external_tenant_id, 300);
  const launchUrl = clean(result.launchUrl || result.launch_url || access.external_launch_url || product.launch_url, 1000);
  if (!tenantId) throw new Error('Produto externo não retornou tenantId.');
  if (launchUrl && !/^https:\/\//i.test(launchUrl)) throw new Error('Produto externo retornou launchUrl inválida.');

  const { error: accessUpdateError } = await admin.from('organization_product_access').update({
    provisioning_status: 'provisioned',
    external_tenant_id: tenantId,
    external_launch_url: launchUrl || null,
    provisioned_at: access.provisioned_at || now,
    provisioning_error: null,
    updated_at: now,
  }).eq('id', access.id);
  if (accessUpdateError) throw accessUpdateError;

  await completeJob(admin, job.id, attempts);

  await admin.from('audit_logs').insert({
    organization_id: access.organization_id,
    user_id: owner.id,
    action: entitled ? 'NEXUS_EXTERNAL_PRODUCT_SYNCED' : 'NEXUS_EXTERNAL_PRODUCT_SUSPENDED',
    entity: 'organization_product_access',
    entity_id: access.id,
    metadata: {
      event,
      product_code: product.code,
      plan_code: plan.code,
      external_tenant_id: tenantId,
      entitlement_allowed: entitled,
      job_id: job.id,
    },
  });

  return {
    jobId: job.id,
    accessId: access.id,
    product: product.code,
    tenantId,
    status: entitled ? 'synchronized_active' : 'synchronized_suspended',
  };
}

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Provisionador não configurado.' }, 503);

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  if (!await isAuthorized(admin, request)) return json({ error: 'Não autorizado.' }, 401);

  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { body = {}; }
  const requestedAccessId = clean(body.accessId, 80);
  const limit = Math.max(1, Math.min(10, Number(body.limit) || 5));
  const now = new Date().toISOString();

  let query = admin
    .from('nexus_product_provisioning_jobs')
    .select('*')
    .in('job_status', ['pending','failed'])
    .lte('next_attempt_at', now)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (requestedAccessId) query = query.eq('access_id', requestedAccessId);

  const { data: jobs, error } = await query;
  if (error) return json({ error: 'Não foi possível carregar a fila de provisionamento.' }, 500);

  const results: unknown[] = [];
  for (const job of jobs || []) {
    const attempts = Number(job.attempts || 0) + 1;
    await admin.from('nexus_product_provisioning_jobs').update({
      job_status: 'processing',
      updated_at: new Date().toISOString(),
    }).eq('id', job.id).in('job_status', ['pending','failed']);

    try {
      results.push(await processJob(admin, job));
    } catch (error) {
      const message = clean(error instanceof Error ? error.message : error, 700) || 'Falha desconhecida no provisionamento.';
      await admin.from('nexus_product_provisioning_jobs').update({
        job_status: 'failed',
        attempts,
        last_error: message,
        next_attempt_at: retryAt(attempts),
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);
      await admin.from('organization_product_access').update({
        provisioning_status: 'failed',
        provisioning_error: message,
        updated_at: new Date().toISOString(),
      }).eq('id', job.access_id);
      results.push({ jobId: job.id, accessId: job.access_id, status: 'failed', error: message });
    }
  }

  return json({ processed: results.length, results });
});
