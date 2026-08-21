import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import Stripe from 'npm:stripe@22.1.1';

const json = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
});

const clean = (value: unknown, size = 300) => String(value ?? '').trim().slice(0, size);
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function stripeEnvironment(secret: string | undefined) {
  return /^(?:sk|rk)_live_/.test(secret || '') ? 'production' : 'sandbox';
}

function livePaymentsEnabled() {
  return Deno.env.get('NEXUS_PAYMENT_LIVE_ENABLED') === 'true';
}

function stripeMessage(error: unknown) {
  const value = error as any;
  return clean(value?.raw?.message || value?.message || 'Não foi possível comunicar com a Stripe.', 700);
}

function trustedOrigin(request: Request) {
  const fallback = (Deno.env.get('NEXUS_PUBLIC_URL') || 'https://nexuscore.app.br').replace(/\/$/, '');
  const raw = clean(request.headers.get('Origin'), 500);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const fallbackUrl = new URL(fallback);
    const isLocal = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    const isWorker = url.protocol === 'https:' && url.hostname.endsWith('.jefersonciechanowski.workers.dev');
    const isConfigured = url.origin === fallbackUrl.origin;
    return isLocal || isWorker || isConfigured ? url.origin : null;
  } catch {
    return null;
  }
}

function corsHeaders(request: Request) {
  const fallback = (Deno.env.get('NEXUS_PUBLIC_URL') || 'https://nexuscore.app.br').replace(/\/$/, '');
  return {
    'Access-Control-Allow-Origin': trustedOrigin(request) || fallback,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function integrationIdentifier() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const suffix = Array.from(bytes, byte => String.fromCharCode(97 + (byte % 26))).join('');
  return `nexus_sst_portal_${suffix}`;
}

async function ensureBrazilTaxId(stripe: Stripe, customerId: string, registrationNumber: string) {
  const taxType = registrationNumber.length === 14 ? 'br_cnpj' : 'br_cpf';
  const existing = await stripe.customers.listTaxIds(customerId, { limit: 100 });
  const found = existing.data.some((item: any) => item.type === taxType && digits(item.value) === registrationNumber);
  if (!found) await stripe.customers.createTaxId(customerId, { type: taxType as any, value: registrationNumber });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return json(request, { error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  const authorization = request.headers.get('Authorization');
  const origin = trustedOrigin(request);

  if (!authorization) return json(request, { error: 'Sessão inválida.' }, 401);
  if (!supabaseUrl || !anonKey || !serviceRoleKey) return json(request, { error: 'Checkout temporariamente indisponível.' }, 503);
  if (!stripeSecretKey) return json(request, { error: 'Checkout temporariamente indisponível.' }, 503);
  if (!origin) return json(request, { error: 'Origem do checkout não permitida.' }, 403);

  const contentType = clean(request.headers.get('content-type'), 100).toLowerCase();
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (!contentType.includes('application/json')) return json(request, { error: 'Conteúdo não suportado.' }, 415);
  if (Number.isFinite(contentLength) && contentLength > 65_536) return json(request, { error: 'Requisição muito grande.' }, 413);

  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { return json(request, { error: 'Corpo da requisição inválido.' }, 400); }
  const accessId = clean(body.accessId, 80);
  if (!accessId) return json(request, { error: 'Informe o acesso que será cobrado.' }, 400);

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json(request, { error: 'Sessão inválida.' }, 401);

  const { data: profile, error: profileError } = await userClient
    .from('profiles')
    .select('organization_id,role,full_name')
    .eq('id', user.id)
    .single();
  if (profileError || !profile?.organization_id) return json(request, { error: 'Perfil sem organização.' }, 403);
  if (!['nexus_admin', 'org_admin'].includes(profile.role)) {
    return json(request, { error: 'Seu perfil não possui permissão para gerar cobranças.' }, 403);
  }

  try {
    const fingerprint = await sha256Hex(`${profile.organization_id}:${user.id}`);
    const { data: allowed, error: rateError } = await adminClient.rpc('consume_nexus_public_request_limit', {
      p_fingerprint_hash: fingerprint,
      p_action: 'authenticated-checkout',
      p_window_seconds: 60,
      p_limit: 10,
    });
    if (rateError) throw rateError;
    if (allowed !== true) return json(request, { error: 'Muitas tentativas de checkout. Aguarde um minuto e tente novamente.' }, 429);
  } catch (error) {
    console.error(JSON.stringify({ message: 'checkout rate limit unavailable', error: clean(error instanceof Error ? error.message : error, 300) }));
    return json(request, { error: 'Serviço temporariamente indisponível.' }, 503);
  }

  const { data: access, error: accessError } = await userClient
    .from('organization_product_access')
    .select('id,organization_id,product_id,plan_id,subscription_status,access_status,contracted_price_cents,contracted_currency,renews_at,billing_provider,provider_customer_id,provider_subscription_id,organization:organizations(name,legal_name,trade_name,registration_number,email,phone,postal_code,street,street_number,address_complement,district,city,state),product:nexus_products(name,code),plan:nexus_plans(id,name,billing_interval_months,status)')
    .eq('id', accessId)
    .single();
  if (accessError || !access) return json(request, { error: 'Assinatura não encontrada ou sem permissão.' }, 404);
  if (profile.role !== 'nexus_admin' && access.organization_id !== profile.organization_id) return json(request, { error: 'Acesso fora da sua organização.' }, 403);

  const plan = Array.isArray(access.plan) ? access.plan[0] : access.plan;
  const organization = Array.isArray(access.organization) ? access.organization[0] : access.organization;
  const product = Array.isArray(access.product) ? access.product[0] : access.product;
  if (!access.plan_id || !plan || plan.status !== 'active') return json(request, { error: 'Selecione um plano comercial ativo antes de gerar o checkout.' }, 409);
  if (access.contracted_price_cents === null || Number(access.contracted_price_cents) <= 0) return json(request, { error: 'A assinatura não possui valor contratado válido.' }, 409);

  const interval = Number(plan.billing_interval_months || 1);
  if (![1, 3, 6, 12].includes(interval)) return json(request, { error: 'Periodicidade não suportada pelo checkout.' }, 409);

  const environment = stripeEnvironment(stripeSecretKey);
  if (environment === 'production' && !livePaymentsEnabled()) {
    return json(request, { error: 'Pagamentos reais ainda não estão habilitados.' }, 503);
  }
  const nowIso = new Date().toISOString();
  const { data: existingCheckout } = await adminClient
    .from('nexus_payment_checkouts')
    .select('id,provider_checkout_url,status,expires_at')
    .eq('access_id', access.id)
    .eq('provider', 'stripe')
    .eq('environment', environment)
    .in('status', ['created', 'active'])
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingCheckout?.provider_checkout_url) return json(request, { checkoutId: existingCheckout.id, link: existingCheckout.provider_checkout_url, reused: true, provider: 'stripe', environment });

  const registrationNumber = digits(organization?.registration_number);
  if (![11, 14].includes(registrationNumber.length)) return json(request, { error: 'Cadastre um CPF ou CNPJ válido na empresa antes de gerar o checkout.' }, 409);

  const stripe = new Stripe(stripeSecretKey, { httpClient: Stripe.createFetchHttpClient() });
  let customerId = access.billing_provider === 'stripe' ? clean(access.provider_customer_id, 200) : '';

  try {
    if (!customerId) {
      const customer = await stripe.customers.create({
        name: clean(organization?.legal_name || organization?.trade_name || organization?.name || profile.full_name || user.email, 120),
        email: clean(organization?.email || user.email, 180) || undefined,
        phone: clean(organization?.phone, 40) || undefined,
        address: {
          line1: clean(organization?.street, 140) ? `${clean(organization?.street, 140)}, ${clean(organization?.street_number, 40)}` : undefined,
          line2: clean(organization?.address_complement, 160) || undefined,
          city: clean(organization?.city, 100) || undefined,
          state: clean(organization?.state, 2) || undefined,
          postal_code: digits(organization?.postal_code) || undefined,
          country: 'BR',
        },
        metadata: {
          nexus_access_id: access.id,
          nexus_organization_id: access.organization_id,
          registration_type: registrationNumber.length === 14 ? 'CNPJ' : 'CPF',
          registration_number: registrationNumber,
        },
      });
      customerId = customer.id;
    }

    await ensureBrazilTaxId(stripe, customerId, registrationNumber);

    const { error: customerSaveError } = await adminClient
      .from('organization_product_access')
      .update({ billing_provider: 'stripe', provider_customer_id: customerId, updated_at: new Date().toISOString() })
      .eq('id', access.id);
    if (customerSaveError) return json(request, { error: 'Cliente criado na Stripe, mas não foi possível salvar o vínculo no Nexus.' }, 500);
  } catch (error) {
    console.error(JSON.stringify({
      message: 'stripe customer setup failed',
      accessId,
      code: clean((error as any)?.code, 100),
      type: clean((error as any)?.type, 100),
      requestId: clean((error as any)?.requestId, 150),
    }));
    return json(request, { error: 'Não foi possível preparar o checkout. Aguarde alguns minutos e tente novamente.' }, 502);
  }

  const checkoutId = crypto.randomUUID();
  const externalReference = `nexus-checkout-${checkoutId}`;
  const callback = `${origin}/apps/portal-cliente/`;

  const { error: insertError } = await adminClient.from('nexus_payment_checkouts').insert({
    id: checkoutId,
    organization_id: access.organization_id,
    access_id: access.id,
    plan_id: access.plan_id,
    provider: 'stripe',
    environment,
    external_reference: externalReference,
    provider_customer_id: customerId,
    status: 'created',
    amount_cents: access.contracted_price_cents,
    currency: access.contracted_currency || 'BRL',
    billing_interval_months: interval,
  });
  if (insertError) return json(request, { error: 'Não foi possível iniciar o checkout.' }, 500);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: checkoutId,
      success_url: `${callback}?pagamento=sucesso&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${callback}?pagamento=cancelado`,
      integration_identifier: integrationIdentifier(),
      line_items: [{
        quantity: 1,
        price_data: {
          currency: String(access.contracted_currency || 'BRL').toLowerCase(),
          unit_amount: Number(access.contracted_price_cents),
          recurring: { interval: 'month', interval_count: interval },
          product_data: {
            name: clean(plan.name, 120),
            description: clean(`${product?.name || 'Nexus'} · ${organization?.name || 'Assinatura Nexus'}`, 400),
          },
        },
      }],
      metadata: {
        nexus_checkout_id: checkoutId,
        nexus_access_id: access.id,
        nexus_organization_id: access.organization_id,
        nexus_plan_id: access.plan_id,
      },
      subscription_data: {
        metadata: {
          nexus_checkout_id: checkoutId,
          nexus_access_id: access.id,
          nexus_organization_id: access.organization_id,
          nexus_plan_id: access.plan_id,
        },
      },
    });

    if (!session.url) throw new Error('A Stripe não retornou o link do checkout.');
    const expiresAt = session.expires_at ? new Date(session.expires_at * 1000).toISOString() : null;
    await adminClient.from('nexus_payment_checkouts').update({
      provider_checkout_id: session.id,
      provider_checkout_url: session.url,
      provider_customer_id: customerId,
      status: 'active',
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    }).eq('id', checkoutId);

    return json(request, { checkoutId, providerCheckoutId: session.id, customerId, link: session.url, status: 'active', environment, provider: 'stripe' });
  } catch (error) {
    const message = stripeMessage(error);
    await adminClient.from('nexus_payment_checkouts').update({ status: 'failed', error_message: message, updated_at: new Date().toISOString() }).eq('id', checkoutId);
    console.error(JSON.stringify({
      message: 'stripe subscription checkout failed',
      checkoutId,
      code: clean((error as any)?.code, 100),
      type: clean((error as any)?.type, 100),
      requestId: clean((error as any)?.requestId, 150),
    }));
    return json(request, { error: 'Não foi possível iniciar o pagamento. Aguarde alguns minutos e tente novamente.' }, 502);
  }
});
