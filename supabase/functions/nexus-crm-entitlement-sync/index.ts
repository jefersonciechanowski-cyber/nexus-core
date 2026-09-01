import { createClient } from 'npm:@supabase/supabase-js@2.112.3';

const allowedEventTypes = new Set([
  'entitlement.activated',
  'entitlement.suspended',
  'entitlement.reactivated',
  'entitlement.cancelled',
  'plan.changed',
]);

const clean = (value: unknown, size = 300) => String(value ?? '').trim().slice(0, size);

function allowedOrigin(request: Request) {
  const raw = clean(request.headers.get('Origin'), 500);
  if (!raw) return 'https://nexuscore.app.br';

  try {
    const url = new URL(raw);
    const isOfficial = url.protocol === 'https:' && ['nexuscore.app.br', 'www.nexuscore.app.br'].includes(url.hostname);
    const isPreview = url.protocol === 'https:' && url.hostname.endsWith('.jefersonciechanowski.workers.dev');
    const isLocal = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    return isOfficial || isPreview || isLocal ? url.origin : null;
  } catch {
    return null;
  }
}

function responseHeaders(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };
}

function isoDate(value: unknown) {
  const raw = clean(value, 20);
  if (!raw) return null;
  const date = new Date(`${raw}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function relationOne<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
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
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  return Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('');
}

function remoteStatus(accessStatus: string, subscriptionStatus: string) {
  if (subscriptionStatus === 'cancelled') return 'cancelled';
  if (accessStatus === 'suspended' || subscriptionStatus === 'past_due') return 'suspended';
  return 'active';
}

function defaultEventType(status: string) {
  if (status === 'cancelled') return 'entitlement.cancelled';
  if (status === 'suspended') return 'entitlement.suspended';
  return 'entitlement.activated';
}

Deno.serve(async request => {
  const origin = allowedOrigin(request);
  const corsOrigin = origin || 'https://nexuscore.app.br';
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const crmEndpoint = clean(Deno.env.get('NEXUS_CRM_ENTITLEMENT_URL'), 1000);
  const webhookSecret = clean(Deno.env.get('NEXUS_CENTRAL_WEBHOOK_SECRET'), 1000);
  const vercelBypassSecret = clean(Deno.env.get('VERCEL_AUTOMATION_BYPASS_SECRET'), 1000);
  const authorization = request.headers.get('Authorization');

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
    return json({ error: 'Integração Nexus Central não configurada.' }, 500);
  }

  if (!crmEndpoint.startsWith('https://') || webhookSecret.length < 32) {
    return json({ error: 'Destino do Nexus CRM não configurado.' }, 503);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'Sessão inválida.' }, 401);

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id,role,active')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError || !profile?.active || profile.role !== 'nexus_admin') {
    return json({ error: 'Apenas a administração Nexus pode sincronizar contratos.' }, 403);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Corpo da requisição inválido.' }, 400);
  }

  const accessId = clean(body.accessId, 80);
  const requestedEventType = clean(body.eventType, 80);
  if (!accessId) return json({ error: 'Acesso comercial não informado.' }, 400);
  if (requestedEventType && !allowedEventTypes.has(requestedEventType)) {
    return json({ error: 'Tipo de evento inválido.' }, 400);
  }

  const { data: access, error: accessError } = await admin
    .from('organization_product_access')
    .select(`
      id,
      organization_id,
      product_id,
      plan_id,
      access_status,
      subscription_status,
      contracted_price_cents,
      starts_at,
      renews_at,
      commercial_condition,
      additional_users,
      base_user_limit_override,
      external_tenant_id,
      product:nexus_products(id,code,name),
      plan:nexus_plans(id,code,name,price_cents,included_user_limit)
    `)
    .eq('id', accessId)
    .maybeSingle();

  if (accessError) return json({ error: 'Não foi possível carregar o contrato.' }, 500);
  if (!access) return json({ error: 'Contrato não encontrado.' }, 404);

  const product = relationOne(access.product as any);
  const plan = relationOne(access.plan as any);

  if (product?.code !== 'crm') {
    return json({ error: 'Este contrato não pertence ao Nexus CRM.' }, 400);
  }

  if (!plan?.code || !['start', 'pro', 'gestao', 'custom'].includes(plan.code)) {
    return json({ error: 'Plano do Nexus CRM inválido.' }, 400);
  }

  const crmOrganizationId = clean(access.external_tenant_id, 80);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(crmOrganizationId)) {
    return json({ error: 'O organization_id correspondente no Nexus CRM não foi configurado.' }, 409);
  }

  const baseMaxUsers = Number(access.base_user_limit_override ?? plan.included_user_limit);
  const additionalUsers = Number(access.additional_users ?? 0);
  const basePriceCents = Number(access.contracted_price_cents ?? plan.price_cents);

  if (!Number.isInteger(baseMaxUsers) || baseMaxUsers < 1) {
    return json({ error: 'Limite-base de usuários do CRM inválido.' }, 409);
  }
  if (!Number.isInteger(additionalUsers) || additionalUsers < 0) {
    return json({ error: 'Quantidade de usuários adicionais inválida.' }, 409);
  }
  if (!Number.isInteger(basePriceCents) || basePriceCents < 0) {
    return json({ error: 'Preço contratado inválido.' }, 409);
  }

  const status = remoteStatus(clean(access.access_status, 30), clean(access.subscription_status, 30));
  const eventType = requestedEventType || defaultEventType(status);
  const occurredAt = new Date().toISOString();

  const payload = {
    event_id: crypto.randomUUID(),
    event_type: eventType,
    occurred_at: occurredAt,
    organization_id: crmOrganizationId,
    central_company_id: clean(access.organization_id, 80),
    contract_id: clean(access.id, 80),
    entitlement: {
      product_code: 'nexus_crm',
      plan_code: plan.code,
      status,
      commercial_condition: access.commercial_condition === 'founder' ? 'founder' : 'standard',
      base_price_cents: basePriceCents,
      base_max_users: baseMaxUsers,
      additional_users: additionalUsers,
      started_at: isoDate(access.starts_at),
      next_renewal_at: isoDate(access.renews_at),
    },
  };

  const rawBody = JSON.stringify(payload);
  const signature = await hmacHex(webhookSecret, rawBody);

  const outboundHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-nexus-signature': `sha256=${signature}`,
  };
  if (vercelBypassSecret) {
    outboundHeaders['x-vercel-protection-bypass'] = vercelBypassSecret;
  }

  let crmResponse: Response;
  try {
    crmResponse = await fetch(crmEndpoint, {
      method: 'POST',
      headers: outboundHeaders,
      body: rawBody,
    });
  } catch (error) {
    console.error('[Nexus CRM entitlement] Falha de rede:', error);
    return json({ error: 'Não foi possível comunicar com o Nexus CRM.' }, 502);
  }

  const crmText = await crmResponse.text();
  let crmPayload: unknown = null;
  try {
    crmPayload = crmText ? JSON.parse(crmText) : null;
  } catch {
    crmPayload = { raw: clean(crmText, 800) };
  }

  if (!crmResponse.ok) {
    console.error('[Nexus CRM entitlement] Destino rejeitou evento:', crmResponse.status, crmPayload);
    return json({
      error: 'O Nexus CRM rejeitou a atualização do contrato.',
      crmStatus: crmResponse.status,
      crmResponse: crmPayload,
    }, 502);
  }

  return json({
    ok: true,
    accessId: access.id,
    organizationId: access.organization_id,
    crmOrganizationId,
    eventType,
    entitlementStatus: status,
    planCode: plan.code,
    baseMaxUsers,
    additionalUsers,
    effectiveMaxUsers: baseMaxUsers + additionalUsers,
    crmResponse: crmPayload,
  });
});
