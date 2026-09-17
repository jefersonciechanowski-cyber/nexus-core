import { createClient } from 'npm:@supabase/supabase-js@2.112.3';

const MAX_BODY_BYTES = 32 * 1024;
const REMOTE_TIMEOUT_MS = 15_000;
const clean = (value: unknown, size = 300) => String(value ?? '').trim().slice(0, size);
const allowedAccessStatuses = new Set(['active', 'suspended']);
const allowedSubscriptionStatuses = new Set(['legacy', 'trial', 'active', 'past_due', 'cancelled']);

function allowedOrigin(request: Request) {
  const raw = clean(request.headers.get('Origin'), 500);
  if (!raw) return 'https://central.nexuscore.app.br';
  try {
    const url = new URL(raw);
    const official = url.protocol === 'https:' && [
      'nexuscore.app.br',
      'www.nexuscore.app.br',
      'central.nexuscore.app.br',
    ].includes(url.hostname);
    const preview = url.protocol === 'https:' && url.hostname.endsWith('.jefersonciechanowski.workers.dev');
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
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

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  return bytesToHex(digest);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseDate(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  const raw = clean(value, 40);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const date = new Date(`${raw}T12:00:00Z`);
  return Number.isFinite(date.getTime()) ? raw : undefined;
}

function remoteStatus(accessStatus: unknown, subscriptionStatus: unknown) {
  const access = clean(accessStatus, 30);
  const subscription = clean(subscriptionStatus, 30);
  if (subscription === 'cancelled') return 'cancelled';
  if (access === 'suspended' || subscription === 'past_due') return 'suspended';
  return 'active';
}

function eventType(previousStatus: string, nextStatus: string, planChanged: boolean) {
  if (nextStatus === 'cancelled') return 'entitlement.cancelled';
  if (previousStatus !== 'suspended' && nextStatus === 'suspended') return 'entitlement.suspended';
  if (previousStatus !== 'active' && nextStatus === 'active') return 'entitlement.reactivated';
  if (planChanged) return 'plan.changed';
  return 'plan.changed';
}

async function sendEntitlement(secret: string, endpoint: string, payload: Record<string, unknown>) {
  const rawBody = JSON.stringify(payload);
  const signature = await hmacHex(secret, rawBody);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-nexus-signature': `sha256=${signature}`,
      },
      body: rawBody,
      signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS),
    });
  } catch (error) {
    const name = clean((error as any)?.name, 80);
    const message = name === 'TimeoutError'
      ? 'Tempo limite excedido ao aguardar confirmação do CRM.'
      : `Falha de rede: ${clean((error as any)?.message, 400)}`;
    return { ok: false, status: 0, detail: message };
  }

  const text = await response.text();
  let body: Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  return {
    ok: response.ok && body?.ok === true,
    status: response.status,
    detail: clean(body?.error || text || `HTTP ${response.status}`, 700),
  };
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
  const webhookSecret = clean(Deno.env.get('NEXUS_CENTRAL_WEBHOOK_SECRET'), 1000);
  const entitlementUrl = clean(
    Deno.env.get('NEXUS_CRM_ENTITLEMENT_URL') || 'https://ngxqtztfotkpdvynstae.supabase.co/functions/v1/nexus-central-entitlement',
    1000,
  );

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization || webhookSecret.length < 32 || !entitlementUrl.startsWith('https://')) {
    return json({ error: 'Integração administrativa do Nexus CRM não configurada.' }, 503);
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
    return json({ error: 'Apenas a administração Nexus pode alterar o acesso do CRM.' }, 403);
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid body');
    body = parsed;
  } catch {
    return json({ error: 'Corpo inválido.' }, 400);
  }

  const accessId = clean(body.accessId, 80);
  const requestedAccessStatus = body.accessStatus === undefined ? undefined : clean(body.accessStatus, 30);
  const requestedSubscriptionStatus = body.subscriptionStatus === undefined ? undefined : clean(body.subscriptionStatus, 30);
  const requestedPlanId = body.planId === undefined ? undefined : clean(body.planId, 80);
  const requestedStartsAt = body.startsAt === undefined ? undefined : parseDate(body.startsAt);
  const requestedRenewsAt = body.renewsAt === undefined ? undefined : parseDate(body.renewsAt);

  if (!isUuid(accessId)) return json({ error: 'Contrato inválido.' }, 400);
  if (requestedAccessStatus !== undefined && !allowedAccessStatuses.has(requestedAccessStatus)) return json({ error: 'Status de acesso inválido.' }, 400);
  if (requestedSubscriptionStatus !== undefined && !allowedSubscriptionStatuses.has(requestedSubscriptionStatus)) return json({ error: 'Situação comercial inválida.' }, 400);
  if (requestedPlanId !== undefined && !isUuid(requestedPlanId)) return json({ error: 'Plano inválido.' }, 400);
  if (requestedStartsAt === undefined && body.startsAt !== undefined) return json({ error: 'Data de início inválida.' }, 400);
  if (requestedRenewsAt === undefined && body.renewsAt !== undefined) return json({ error: 'Data de renovação inválida.' }, 400);

  const { data: access, error: accessError } = await admin
    .from('organization_product_access')
    .select('id,organization_id,product_id,plan_id,access_status,subscription_status,plan_name,contracted_price_cents,contracted_currency,commercial_condition,additional_users,base_user_limit_override,starts_at,renews_at,billing_mode,billing_cycle_months,external_tenant_id,updated_at')
    .eq('id', accessId)
    .maybeSingle();
  if (accessError || !access?.id) return json({ error: 'Contrato não encontrado.' }, 404);

  const { data: product, error: productError } = await admin
    .from('nexus_products')
    .select('id,code,status')
    .eq('id', access.product_id)
    .maybeSingle();
  if (productError || product?.code !== 'crm') return json({ error: 'Este comando é exclusivo do Nexus CRM.' }, 409);
  if (!access.external_tenant_id || !isUuid(clean(access.external_tenant_id, 80))) {
    return json({ error: 'O cliente ainda não possui vínculo confirmado com o tenant do Nexus CRM.' }, 409);
  }

  const targetPlanId = requestedPlanId ?? clean(access.plan_id, 80);
  if (!isUuid(targetPlanId)) return json({ error: 'O contrato do CRM não possui plano válido.' }, 409);

  const { data: currentPlan, error: currentPlanError } = await admin
    .from('nexus_plans')
    .select('id,product_id,code,name,price_cents,included_user_limit,billing_interval_months,status')
    .eq('id', access.plan_id)
    .maybeSingle();
  const { data: targetPlan, error: targetPlanError } = await admin
    .from('nexus_plans')
    .select('id,product_id,code,name,price_cents,included_user_limit,billing_interval_months,status')
    .eq('id', targetPlanId)
    .maybeSingle();
  if (currentPlanError || !currentPlan?.id || targetPlanError || !targetPlan?.id || targetPlan.product_id !== access.product_id || targetPlan.status !== 'active') {
    return json({ error: 'Plano comercial do CRM inválido ou inativo.' }, 409);
  }

  const previousAccessStatus = clean(access.access_status, 30);
  const previousSubscriptionStatus = clean(access.subscription_status, 30);
  const targetAccessStatus = requestedAccessStatus ?? previousAccessStatus;
  const targetSubscriptionStatus = requestedSubscriptionStatus ?? previousSubscriptionStatus;
  const planChanged = targetPlan.id !== currentPlan.id;
  const targetStartsAt = requestedStartsAt !== undefined ? requestedStartsAt : access.starts_at;
  const targetRenewsAt = requestedRenewsAt !== undefined ? requestedRenewsAt : access.renews_at;
  const previousRemoteStatus = remoteStatus(previousAccessStatus, previousSubscriptionStatus);
  const targetRemoteStatus = remoteStatus(targetAccessStatus, targetSubscriptionStatus);
  const commercialCondition = ['founder', 'courtesy'].includes(clean(access.commercial_condition, 30))
    ? clean(access.commercial_condition, 30)
    : 'standard';

  const targetBaseUsers = Number(access.base_user_limit_override ?? targetPlan.included_user_limit);
  const previousBaseUsers = Number(access.base_user_limit_override ?? currentPlan.included_user_limit);
  const additionalUsers = Number(access.additional_users ?? 0);
  if (!Number.isInteger(targetBaseUsers) || targetBaseUsers < 1 || !Number.isInteger(previousBaseUsers) || previousBaseUsers < 1 || !Number.isInteger(additionalUsers) || additionalUsers < 0) {
    return json({ error: 'Limites de usuários do contrato estão inválidos.' }, 409);
  }

  const targetPrice = access.billing_mode === 'prepaid'
    ? Number(access.contracted_price_cents ?? targetPlan.price_cents)
    : Number(planChanged ? targetPlan.price_cents : (access.contracted_price_cents ?? targetPlan.price_cents));
  const previousPrice = Number(access.contracted_price_cents ?? currentPlan.price_cents);
  if (!Number.isInteger(targetPrice) || targetPrice < 0 || !Number.isInteger(previousPrice) || previousPrice < 0) {
    return json({ error: 'Preço contratado inválido.' }, 409);
  }

  const occurredAt = new Date().toISOString();
  const buildPayload = (type: string, state: {
    plan: any;
    status: string;
    price: number;
    baseUsers: number;
    startsAt: string | null;
    renewsAt: string | null;
  }) => ({
    event_id: crypto.randomUUID(),
    event_type: type,
    occurred_at: occurredAt,
    organization_id: clean(access.external_tenant_id, 80),
    central_company_id: clean(access.organization_id, 80),
    contract_id: clean(access.id, 80),
    entitlement: {
      product_code: 'nexus_crm',
      plan_code: clean(state.plan.code, 40),
      status: state.status,
      commercial_condition: commercialCondition,
      base_price_cents: state.price,
      base_max_users: state.baseUsers,
      additional_users: additionalUsers,
      started_at: state.startsAt || null,
      next_renewal_at: state.renewsAt || null,
    },
  });

  const targetPayload = buildPayload(eventType(previousRemoteStatus, targetRemoteStatus, planChanged), {
    plan: targetPlan,
    status: targetRemoteStatus,
    price: targetPrice,
    baseUsers: targetBaseUsers,
    startsAt: targetStartsAt || null,
    renewsAt: targetRenewsAt || null,
  });

  const remote = await sendEntitlement(webhookSecret, entitlementUrl, targetPayload);
  if (!remote.ok) {
    await admin.from('audit_logs').insert({
      organization_id: access.organization_id,
      user_id: user.id,
      action: 'NEXUS_CRM_ENTITLEMENT_SYNC_FAILED',
      entity: 'organization_product_access',
      entity_id: access.id,
      metadata: { stage: 'remote_before_local', status: remote.status, detail: remote.detail },
    });
    return json({ error: `O CRM não confirmou a alteração. Nada foi alterado na Central. ${remote.detail}` }, 502);
  }

  const localPatch: Record<string, unknown> = {
    access_status: targetAccessStatus,
    subscription_status: targetSubscriptionStatus,
    plan_id: targetPlan.id,
    starts_at: targetStartsAt || null,
    renews_at: targetRenewsAt || null,
    updated_at: new Date().toISOString(),
  };
  if (access.billing_mode !== 'prepaid') {
    localPatch.plan_name = targetPlan.name;
    localPatch.contracted_price_cents = targetPrice;
    localPatch.billing_cycle_months = Number(targetPlan.billing_interval_months || access.billing_cycle_months || 1);
  }

  const localMutation = admin
    .from('organization_product_access')
    .update(localPatch)
    .eq('id', access.id);
  const { data: updatedLocal, error: localError } = access.updated_at
    ? await localMutation.eq('updated_at', access.updated_at).select('id').maybeSingle()
    : await localMutation.select('id').maybeSingle();

  if (localError || !updatedLocal?.id) {
    const compensation = buildPayload('plan.changed', {
      plan: currentPlan,
      status: previousRemoteStatus,
      price: previousPrice,
      baseUsers: previousBaseUsers,
      startsAt: access.starts_at || null,
      renewsAt: access.renews_at || null,
    });
    compensation.event_id = crypto.randomUUID();
    compensation.occurred_at = new Date(Date.now() + 1000).toISOString();
    const compensationResult = await sendEntitlement(webhookSecret, entitlementUrl, compensation);

    await admin.from('audit_logs').insert({
      organization_id: access.organization_id,
      user_id: user.id,
      action: 'NEXUS_CRM_ENTITLEMENT_LOCAL_FAILED',
      entity: 'organization_product_access',
      entity_id: access.id,
      metadata: {
        local_error: clean(localError?.message || 'Contrato alterado por outra operação concorrente.', 700),
        compensation_ok: compensationResult.ok,
        compensation_status: compensationResult.status,
        compensation_detail: compensationResult.detail,
      },
    });

    return json({
      error: compensationResult.ok
        ? 'A Central não conseguiu salvar a alteração; o CRM foi restaurado ao estado anterior.'
        : 'Falha crítica de sincronização. A alteração não foi salva na Central e a compensação do CRM também falhou. Revisão manual obrigatória.',
      requires_manual_review: !compensationResult.ok,
    }, 500);
  }

  await admin.from('audit_logs').insert({
    organization_id: access.organization_id,
    user_id: user.id,
    action: 'NEXUS_CRM_ENTITLEMENT_SYNCED',
    entity: 'organization_product_access',
    entity_id: access.id,
    metadata: {
      event_id: targetPayload.event_id,
      event_type: targetPayload.event_type,
      crm_organization_id: access.external_tenant_id,
      previous_status: previousRemoteStatus,
      next_status: targetRemoteStatus,
      previous_plan: currentPlan.code,
      next_plan: targetPlan.code,
    },
  });

  return json({
    ok: true,
    accessId: access.id,
    crmOrganizationId: access.external_tenant_id,
    accessStatus: targetAccessStatus,
    subscriptionStatus: targetSubscriptionStatus,
    remoteStatus: targetRemoteStatus,
    planCode: targetPlan.code,
  });
});
