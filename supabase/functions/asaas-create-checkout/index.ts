import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const clean = (value: unknown, size = 300) => String(value ?? '').trim().slice(0, size);
const cycleByMonths: Record<number, string> = { 1: 'MONTHLY', 3: 'QUARTERLY', 6: 'SEMIANNUALLY', 12: 'YEARLY' };

function checkoutLink(baseUrl: string, id: string) {
  return baseUrl.includes('api-sandbox')
    ? `https://sandbox.asaas.com/checkoutSession/show/${id}`
    : `https://asaas.com/checkoutSession/show/${id}`;
}

function callbackBase(request: Request) {
  const origin = clean(request.headers.get('Origin'), 500);
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return null;
    return url.origin;
  } catch {
    return null;
  }
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const asaasApiKey = Deno.env.get('ASAAS_API_KEY');
  const asaasBaseUrl = (Deno.env.get('ASAAS_API_BASE_URL') || 'https://api-sandbox.asaas.com/v3').replace(/\/$/, '');
  const authorization = request.headers.get('Authorization');
  const origin = callbackBase(request);

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) return json({ error: 'Integração Supabase não configurada.' }, 500);
  if (!asaasApiKey) return json({ error: 'Configure ASAAS_API_KEY nos secrets da Edge Function.' }, 503);
  if (!origin) return json({ error: 'Origem do checkout não permitida.' }, 400);

  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { return json({ error: 'Corpo da requisição inválido.' }, 400); }
  const accessId = clean(body.accessId, 80);
  if (!accessId) return json({ error: 'Informe o acesso que será cobrado.' }, 400);

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'Sessão inválida.' }, 401);

  const { data: profile, error: profileError } = await userClient
    .from('profiles')
    .select('organization_id,role,name')
    .eq('id', user.id)
    .single();
  if (profileError || !profile?.organization_id) return json({ error: 'Perfil sem organização.' }, 403);

  const { data: access, error: accessError } = await userClient
    .from('organization_product_access')
    .select('id,organization_id,product_id,plan_id,subscription_status,access_status,contracted_price_cents,contracted_currency,renews_at,organization:organizations(name),product:nexus_products(name),plan:nexus_plans(id,name,billing_interval_months,status)')
    .eq('id', accessId)
    .single();
  if (accessError || !access) return json({ error: 'Assinatura não encontrada ou sem permissão.' }, 404);
  if (profile.role !== 'nexus_admin' && access.organization_id !== profile.organization_id) return json({ error: 'Acesso fora da sua organização.' }, 403);
  if (!access.plan_id || !access.plan || access.plan.status !== 'active') return json({ error: 'Selecione um plano comercial ativo antes de gerar o checkout.' }, 409);
  if (access.contracted_price_cents === null || Number(access.contracted_price_cents) <= 0) return json({ error: 'A assinatura não possui valor contratado válido.' }, 409);

  const interval = Number(access.plan.billing_interval_months);
  const cycle = cycleByMonths[interval];
  if (!cycle) return json({ error: 'Periodicidade não suportada pelo checkout.' }, 409);

  const now = new Date();
  const nowIso = now.toISOString();
  const { data: existingCheckout } = await adminClient
    .from('nexus_payment_checkouts')
    .select('id,provider_checkout_url,status,expires_at')
    .eq('access_id', access.id)
    .in('status', ['created', 'active'])
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingCheckout?.provider_checkout_url) {
    return json({ checkoutId: existingCheckout.id, link: existingCheckout.provider_checkout_url, reused: true });
  }

  const checkoutId = crypto.randomUUID();
  const externalReference = `nexus-checkout-${checkoutId}`;
  const minutesToExpire = 60;
  const expiresAt = new Date(now.getTime() + minutesToExpire * 60_000).toISOString();
  const environment = asaasBaseUrl.includes('api-sandbox') ? 'sandbox' : 'production';
  const price = Number(access.contracted_price_cents) / 100;
  const dueDate = now.toISOString().slice(0, 10);
  const organization = Array.isArray(access.organization) ? access.organization[0] : access.organization;
  const product = Array.isArray(access.product) ? access.product[0] : access.product;

  const { error: insertError } = await adminClient.from('nexus_payment_checkouts').insert({
    id: checkoutId,
    organization_id: access.organization_id,
    access_id: access.id,
    plan_id: access.plan_id,
    provider: 'asaas',
    environment,
    external_reference: externalReference,
    status: 'created',
    amount_cents: access.contracted_price_cents,
    currency: access.contracted_currency || 'BRL',
    billing_interval_months: interval,
    expires_at: expiresAt,
  });
  if (insertError) return json({ error: 'Não foi possível iniciar o checkout.' }, 500);

  const callback = `${origin}/apps/portal-cliente/`;
  const payload = {
    billingTypes: ['CREDIT_CARD', 'PIX'],
    chargeTypes: ['RECURRENT'],
    minutesToExpire,
    externalReference,
    callback: {
      successUrl: `${callback}?pagamento=sucesso`,
      cancelUrl: `${callback}?pagamento=cancelado`,
      expiredUrl: `${callback}?pagamento=expirado`,
    },
    items: [{
      externalReference: access.plan_id,
      name: clean(access.plan.name, 100),
      description: clean(`${product?.name || 'Nexus'} · ${organization?.name || 'Assinatura Nexus'}`, 200),
      quantity: 1,
      value: price,
    }],
    customerData: {
      name: clean(profile.name || user.user_metadata?.name || organization?.name || user.email, 100),
      email: clean(user.email, 150),
    },
    subscription: { cycle, nextDueDate: `${dueDate}T12:00:00-03:00` },
  };

  try {
    const response = await fetch(`${asaasBaseUrl}/checkouts`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'access_token': asaasApiKey,
        'User-Agent': 'NexusCore/1.0 (Supabase Edge Function)',
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok || !result?.id) {
      const message = clean(result?.errors?.[0]?.description || result?.message || 'Checkout recusado pelo Asaas.', 700);
      await adminClient.from('nexus_payment_checkouts').update({ status: 'failed', error_message: message, updated_at: new Date().toISOString() }).eq('id', checkoutId);
      return json({ error: message }, response.status >= 400 && response.status < 500 ? 400 : 502);
    }

    const link = clean(result.link || checkoutLink(asaasBaseUrl, result.id), 1000);
    const providerStatus = clean(result.status || 'ACTIVE', 30).toUpperCase();
    const status = providerStatus === 'PAID' ? 'paid' : providerStatus === 'EXPIRED' ? 'expired' : providerStatus === 'CANCELED' ? 'canceled' : 'active';
    await adminClient.from('nexus_payment_checkouts').update({
      provider_checkout_id: clean(result.id, 200),
      provider_checkout_url: link,
      status,
      updated_at: new Date().toISOString(),
    }).eq('id', checkoutId);

    return json({ checkoutId, providerCheckoutId: result.id, link, status, environment });
  } catch (error) {
    const message = clean(error instanceof Error ? error.message : error, 700);
    await adminClient.from('nexus_payment_checkouts').update({ status: 'failed', error_message: message, updated_at: new Date().toISOString() }).eq('id', checkoutId);
    return json({ error: 'Não foi possível comunicar com o Asaas.' }, 502);
  }
});
