import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { provisionCrmTenant } from '../_shared/crm-provisioning.ts';

const MAX_BODY_BYTES = 24 * 1024;
const clean = (value: unknown, size = 300) => String(value ?? '').trim().slice(0, size);
const validEmail = (value: string) => value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function allowedOrigin(request: Request) {
  const raw = clean(request.headers.get('Origin'), 500);
  if (!raw) return 'https://central.nexuscore.app.br';
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const official = url.protocol === 'https:' && [
      'nexuscore.app.br',
      'www.nexuscore.app.br',
      'central.nexuscore.app.br',
    ].includes(host);
    const preview = url.protocol === 'https:' && host.endsWith('.jefersonciechanowski.workers.dev');
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(host);
    return official || preview || local ? url.origin : null;
  } catch {
    return null;
  }
}

function responseHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function slugify(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'cliente';
}

function addUtcMonths(start: Date, months: number) {
  const year = start.getUTCFullYear();
  const month = start.getUTCMonth();
  const day = start.getUTCDate();
  const targetMonthStart = new Date(Date.UTC(year, month + months, 1));
  const lastTargetDay = new Date(Date.UTC(targetMonthStart.getUTCFullYear(), targetMonthStart.getUTCMonth() + 1, 0)).getUTCDate();
  targetMonthStart.setUTCDate(Math.min(day, lastTargetDay));
  return targetMonthStart.toISOString().slice(0, 10);
}

Deno.serve(async request => {
  const origin = allowedOrigin(request);
  const corsOrigin = origin || 'https://central.nexuscore.app.br';
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(corsOrigin),
  });

  if (request.method === 'OPTIONS') {
    if (!origin) return new Response(null, { status: 403, headers: responseHeaders(corsOrigin) });
    return new Response(null, { status: 204, headers: responseHeaders(corsOrigin) });
  }
  if (!origin) return json({ error: 'Origem não permitida.' }, 403);
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const contentLength = Number(request.headers.get('content-length') || '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return json({ error: 'Payload muito grande.' }, 413);
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return json({ error: 'Payload muito grande.' }, 413);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
    return json({ error: 'Integração administrativa Nexus não configurada.' }, 503);
  }

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'Sessão inválida.' }, 401);

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id,role,active')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError || !profile?.active || profile.role !== 'nexus_admin') {
    return json({ error: 'Apenas a administração Nexus pode conceder cortesia do CRM.' }, 403);
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid');
    body = parsed;
  } catch {
    return json({ error: 'Corpo inválido.' }, 400);
  }

  const companyName = clean(body.companyName, 160).replace(/\s+/g, ' ');
  const responsibleName = clean(body.responsibleName, 160).replace(/\s+/g, ' ');
  const email = clean(body.email, 254).toLowerCase();
  const planId = clean(body.planId, 80);
  const durationMonths = Number(body.durationMonths ?? 3);

  if (companyName.length < 2) return json({ error: 'Informe o nome da empresa.' }, 400);
  if (responsibleName.length < 2) return json({ error: 'Informe o responsável.' }, 400);
  if (!validEmail(email)) return json({ error: 'Informe um e-mail válido.' }, 400);
  if (!isUuid(planId)) return json({ error: 'Plano inválido.' }, 400);
  if (!Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > 24) {
    return json({ error: 'O prazo da cortesia deve ficar entre 1 e 24 meses.' }, 400);
  }

  const courtesyStartedAt = new Date().toISOString().slice(0, 10);
  const courtesyEndsAt = addUtcMonths(new Date(`${courtesyStartedAt}T12:00:00Z`), durationMonths);

  const { data: plan, error: planError } = await admin
    .from('nexus_plans')
    .select('id,product_id,code,name,currency,billing_interval_months,included_user_limit,status')
    .eq('id', planId)
    .eq('status', 'active')
    .maybeSingle();
  if (planError || !plan?.id) return json({ error: 'Plano não encontrado ou inativo.' }, 409);

  const { data: product, error: productError } = await admin
    .from('nexus_products')
    .select('id,code,status')
    .eq('id', plan.product_id)
    .maybeSingle();
  if (productError || product?.code !== 'crm' || product.status !== 'active') {
    return json({ error: 'O plano selecionado não pertence ao Nexus CRM ativo.' }, 409);
  }

  const includedUsers = Number(plan.included_user_limit);
  if (!Number.isInteger(includedUsers) || includedUsers < 1 || includedUsers > 100) {
    return json({ error: 'O plano do CRM possui limite de usuários inválido.' }, 409);
  }

  const { data: emailOrganizations, error: organizationsError } = await admin
    .from('organizations')
    .select('id,name,email,status')
    .ilike('email', email)
    .limit(2);
  if (organizationsError) return json({ error: 'Não foi possível verificar a empresa na Nexus Central.' }, 500);
  if ((emailOrganizations ?? []).length > 1) {
    return json({ error: 'Há mais de uma empresa com este e-mail na Central. Revise o cadastro antes de conceder a cortesia.' }, 409);
  }

  let organizationId = clean(emailOrganizations?.[0]?.id, 80);
  let createdOrganization = false;
  if (!organizationId) {
    const organizationUuid = crypto.randomUUID();
    const slug = `${slugify(companyName)}-crm-${organizationUuid.replace(/-/g, '').slice(0, 8)}`;
    const { data: createdOrganizationRow, error: createOrganizationError } = await admin
      .from('organizations')
      .insert({
        id: organizationUuid,
        name: companyName,
        slug,
        status: 'active',
        email,
        legal_responsible_name: responsibleName,
      })
      .select('id')
      .single();
    if (createOrganizationError || !createdOrganizationRow?.id) {
      return json({ error: 'Não foi possível criar a empresa na Nexus Central.' }, 500);
    }
    organizationId = createdOrganizationRow.id;
    createdOrganization = true;
  }

  const { data: existingAccess, error: existingAccessError } = await admin
    .from('organization_product_access')
    .select('id,organization_id,product_id,plan_id,access_status,subscription_status,commercial_condition,external_tenant_id')
    .eq('organization_id', organizationId)
    .eq('product_id', product.id)
    .maybeSingle();
  if (existingAccessError) return json({ error: 'Não foi possível verificar o contrato CRM existente.' }, 500);

  if (existingAccess?.id && existingAccess.commercial_condition !== 'courtesy') {
    return json({ error: 'Esta empresa já possui um contrato do Nexus CRM que não é cortesia. Use o controle do contrato existente.' }, 409);
  }

  let access = existingAccess;
  if (!access?.id) {
    const { data: insertedAccess, error: accessInsertError } = await admin
      .from('organization_product_access')
      .insert({
        organization_id: organizationId,
        product_id: product.id,
        access_status: 'active',
        subscription_status: 'active',
        plan_name: `${plan.name} · Cortesia`,
        starts_at: courtesyStartedAt,
        renews_at: courtesyEndsAt,
        plan_id: plan.id,
        contracted_price_cents: 0,
        contracted_currency: String(plan.currency || 'BRL'),
        billing_provider: null,
        provider_customer_id: null,
        provider_subscription_id: null,
        billing_mode: 'prepaid',
        billing_cycle_months: durationMonths,
        commercial_condition: 'courtesy',
        base_user_limit_override: includedUsers,
        additional_users: 0,
      })
      .select('id,organization_id,product_id,plan_id,access_status,subscription_status,commercial_condition,external_tenant_id')
      .single();

    if (accessInsertError || !insertedAccess?.id) {
      if (createdOrganization) {
        const { error: cleanupError } = await admin.from('organizations').delete().eq('id', organizationId);
        if (cleanupError) console.error('[Nexus CRM courtesy] Falha ao remover empresa sem contrato:', cleanupError.message);
      }
      return json({ error: 'Não foi possível registrar a cortesia na Nexus Central.' }, 500);
    }
    access = insertedAccess;
  } else {
    if (access.external_tenant_id) {
      return json({
        ok: true,
        alreadyProvisioned: true,
        organizationId,
        accessId: access.id,
        crmOrganizationId: access.external_tenant_id,
        firstAccessUrl: null,
        courtesyEndsAt,
        message: 'Esta cortesia já está provisionada. Para um novo link de acesso, use a recuperação de senha do CRM.',
      });
    }

    const { data: refreshed, error: refreshError } = await admin
      .from('organization_product_access')
      .update({
        plan_id: plan.id,
        plan_name: `${plan.name} · Cortesia`,
        access_status: 'active',
        subscription_status: 'active',
        starts_at: courtesyStartedAt,
        renews_at: courtesyEndsAt,
        contracted_price_cents: 0,
        contracted_currency: String(plan.currency || 'BRL'),
        billing_provider: null,
        provider_customer_id: null,
        provider_subscription_id: null,
        billing_mode: 'prepaid',
        billing_cycle_months: durationMonths,
        commercial_condition: 'courtesy',
        base_user_limit_override: includedUsers,
        additional_users: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', access.id)
      .eq('commercial_condition', 'courtesy')
      .select('id,organization_id,product_id,plan_id,access_status,subscription_status,commercial_condition,external_tenant_id')
      .maybeSingle();
    if (refreshError || !refreshed?.id) return json({ error: 'Não foi possível preparar o retry da cortesia.' }, 409);
    access = refreshed;
  }

  const saleLike = {
    id: crypto.randomUUID(),
    plan_id: plan.id,
    company_name: companyName,
    responsible_name: responsibleName,
    email,
  };

  const provisioned = await provisionCrmTenant(admin, saleLike, access, 'administrative');
  if (!provisioned.isCrm || provisioned.error || !provisioned.crmOrganizationId) {
    await admin.from('audit_logs').insert({
      organization_id: organizationId,
      user_id: user.id,
      action: 'NEXUS_CRM_COURTESY_PROVISION_FAILED',
      entity: 'organization_product_access',
      entity_id: access.id,
      metadata: {
        email,
        plan_id: plan.id,
        duration_months: durationMonths,
        courtesy_ends_at: courtesyEndsAt,
        error: clean(provisioned.error || 'CRM não confirmou o provisionamento.', 700),
        retry_safe: true,
      },
    });
    return json({
      error: 'A cortesia ficou registrada na Central, mas o CRM não confirmou o provisionamento. É seguro tentar novamente com os mesmos dados.',
      retryable: true,
      organizationId,
      accessId: access.id,
    }, 502);
  }

  await admin.from('audit_logs').insert({
    organization_id: organizationId,
    user_id: user.id,
    action: 'NEXUS_CRM_COURTESY_PROVISIONED',
    entity: 'organization_product_access',
    entity_id: access.id,
    metadata: {
      email,
      plan_id: plan.id,
      crm_organization_id: provisioned.crmOrganizationId,
      price_cents: 0,
      commercial_condition: 'courtesy',
      duration_months: durationMonths,
      courtesy_ends_at: courtesyEndsAt,
    },
  });

  return json({
    ok: true,
    organizationId,
    accessId: access.id,
    crmOrganizationId: provisioned.crmOrganizationId,
    firstAccessUrl: provisioned.firstAccessUrl,
    email,
    planName: plan.name,
    durationMonths,
    courtesyEndsAt,
    message: provisioned.firstAccessUrl
      ? `Cortesia provisionada até ${courtesyEndsAt}. Copie o link de primeiro acesso e envie somente ao cliente correto.`
      : `Cortesia provisionada até ${courtesyEndsAt}. O CRM já conhecia este tenant; gere o acesso pela recuperação de senha se necessário.`,
  });
});
