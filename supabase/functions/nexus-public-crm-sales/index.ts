import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import Stripe from 'npm:stripe@22.1.1';

const clean = (value: unknown, size = 300) => String(value ?? '').trim().slice(0, size);
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const states = new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);

function requestOrigin(request: Request) {
  return clean(request.headers.get('Origin'), 500);
}

function allowedOrigin(request: Request) {
  const raw = requestOrigin(request);
  if (!raw) return true;
  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(hostname);
    const nexusCore = url.protocol === 'https:' && (hostname === 'nexuscore.app.br' || hostname.endsWith('.nexuscore.app.br'));
    const crmVercel = url.protocol === 'https:' && hostname.endsWith('.vercel.app') && hostname.includes('nexus-crm');
    return local || nexusCore || crmVercel;
  } catch {
    return false;
  }
}

function corsHeaders(request: Request) {
  const raw = requestOrigin(request);
  const origin = allowedOrigin(request) && raw ? raw : 'https://nexuscore.app.br';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
  });
}

function clientAddress(request: Request) {
  const cloudflare = clean(request.headers.get('cf-connecting-ip'), 100);
  if (cloudflare) return cloudflare;
  const real = clean(request.headers.get('x-real-ip'), 100);
  if (real) return real;
  return clean(request.headers.get('x-forwarded-for'), 500).split(',')[0]?.trim() || 'unknown';
}

async function hmacHex(secret: string, value: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  return Array.from(signature, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function consumeRateLimit(admin: any, request: Request, secretMaterial: string) {
  const fingerprint = await hmacHex(secretMaterial, `crm-checkout:${clientAddress(request)}`);
  const { data, error } = await admin.rpc('consume_nexus_public_request_limit', {
    p_fingerprint_hash: fingerprint,
    p_action: 'crm-checkout',
    p_window_seconds: 900,
    p_limit: 8,
  });
  if (error) throw error;
  return data === true;
}

function stripeEnvironment(secret: string | undefined) {
  return /^(?:sk|rk)_live_/.test(secret || '') ? 'production' : 'sandbox';
}

function liveCrmPaymentsEnabled() {
  return Deno.env.get('NEXUS_CRM_PAYMENT_LIVE_ENABLED') === 'true';
}

function stripeMessage(error: unknown) {
  const value = error as any;
  return clean(value?.raw?.message || value?.message || 'Não foi possível comunicar com a Stripe.', 700);
}

async function resolveCrmProduct(admin: any) {
  for (const code of ['crm', 'nexus-crm', 'nexus_crm']) {
    const { data } = await admin.from('nexus_products').select('id,name,code').eq('code', code).eq('status', 'active').maybeSingle();
    if (data?.id) return data;
  }
  const { data } = await admin.from('nexus_products').select('id,name,code').eq('status', 'active').ilike('name', '%CRM%').limit(1).maybeSingle();
  return data?.id ? data : null;
}

async function resolvePlan(admin: any, productId: string, planCode: string) {
  const aliases: Record<string, string[]> = {
    start: ['start', 'crm-start', 'nexus-crm-start'],
    pro: ['pro', 'crm-pro', 'nexus-crm-pro'],
    gestao: ['gestao', 'gestão', 'crm-gestao', 'nexus-crm-gestao'],
  };
  for (const code of aliases[planCode] || [planCode]) {
    const { data } = await admin
      .from('nexus_plans')
      .select('id,product_id,code,name,price_cents,currency,billing_interval_months,status,public_visible')
      .eq('product_id', productId)
      .eq('code', code)
      .eq('status', 'active')
      .maybeSingle();
    if (data?.id) return data;
  }
  return null;
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return json(request, { error: 'Método não permitido.' }, 405);
  if (!allowedOrigin(request)) return json(request, { error: 'Origem não autorizada.' }, 403);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!supabaseUrl || !serviceRoleKey || !stripeSecretKey) return json(request, { error: 'Checkout Nexus não configurado.' }, 500);

  const contentType = clean(request.headers.get('content-type'), 100).toLowerCase();
  if (!contentType.includes('application/json')) return json(request, { error: 'Conteúdo não suportado.' }, 415);

  let body: Record<string, any> = {};
  try { body = await request.json(); } catch { return json(request, { error: 'Corpo da requisição inválido.' }, 400); }

  const companyName = clean(body.companyName, 140);
  const responsibleName = clean(body.responsibleName, 140);
  const email = clean(body.email, 180).toLowerCase();
  const phone = digits(body.phone).slice(0, 15);
  const planCode = clean(body.planCode, 80).toLowerCase();
  const registrationNumber = digits(body.registrationNumber);
  const postalCode = digits(body.postalCode);
  const street = clean(body.street, 140);
  const streetNumber = clean(body.streetNumber, 40);
  const addressComplement = clean(body.addressComplement, 160);
  const district = clean(body.district, 100);
  const city = clean(body.city, 100);
  const state = clean(body.state, 2).toUpperCase();
  const acceptedTerms = body.acceptedTerms === true;
  const honeypot = clean(body.website, 100);

  if (honeypot) return json(request, { ok: true });
  if (companyName.length < 2 || responsibleName.length < 2 || !validEmail(email) || phone.length < 10) {
    return json(request, { error: 'Preencha empresa, responsável, e-mail e telefone válidos.' }, 400);
  }
  if (!['start', 'pro', 'gestao'].includes(planCode)) return json(request, { error: 'Plano inválido.' }, 400);
  if (![11, 14].includes(registrationNumber.length)) return json(request, { error: 'Informe um CPF ou CNPJ válido.' }, 400);
  if (postalCode.length !== 8 || !street || !streetNumber || !district || !city || !states.has(state)) {
    return json(request, { error: 'Preencha o endereço completo para gerar a cobrança.' }, 400);
  }
  if (!acceptedTerms) return json(request, { error: 'Confirme os dados e os termos para continuar.' }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    if (!await consumeRateLimit(admin, request, serviceRoleKey)) {
      return json(request, { error: 'Muitas tentativas recentes. Aguarde alguns minutos e tente novamente.' }, 429);
    }
  } catch (error) {
    console.error('Rate limit do checkout CRM indisponível:', clean((error as any)?.message, 300));
    return json(request, { error: 'Serviço temporariamente indisponível.' }, 503);
  }

  const product = await resolveCrmProduct(admin);
  if (!product?.id) return json(request, { error: 'Produto Nexus CRM não encontrado na Central.' }, 503);
  const plan = await resolvePlan(admin, product.id, planCode);
  if (!plan?.id || Number(plan.price_cents) <= 0) return json(request, { error: 'Plano comercial indisponível.' }, 409);

  const environment = stripeEnvironment(stripeSecretKey);
  if (environment === 'production' && !liveCrmPaymentsEnabled()) {
    return json(request, { error: 'A contratação online do Nexus CRM ainda está em homologação.' }, 503);
  }

  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count } = await admin.from('nexus_sales').select('id', { count: 'exact', head: true })
    .eq('product_id', product.id).eq('email', email).gte('created_at', fifteenMinutesAgo);
  if ((count || 0) >= 5) return json(request, { error: 'Muitas tentativas recentes para este e-mail.' }, 429);

  const saleId = crypto.randomUUID();
  const origin = requestOrigin(request) || 'https://nexuscore.app.br';
  const externalReference = `nexus-crm-sale-${saleId}`;
  const registrationType = registrationNumber.length === 14 ? 'CNPJ' : 'CPF';

  const { error: saleError } = await admin.from('nexus_sales').insert({
    id: saleId,
    product_id: product.id,
    plan_id: plan.id,
    sale_status: 'lead',
    source: 'site-captacao',
    company_name: companyName,
    responsible_name: responsibleName,
    email,
    phone,
    registration_type: registrationType,
    registration_number: registrationNumber,
    postal_code: postalCode,
    street,
    street_number: streetNumber,
    address_complement: addressComplement || null,
    district,
    city,
    state,
    provider: 'stripe',
    environment,
    return_origin: origin,
    external_reference: externalReference,
    billing_mode: 'recurring',
    billing_cycle_months: Number(plan.billing_interval_months || 1),
    checkout_amount_cents: Number(plan.price_cents),
    lead_stage: 'new',
    campaign_name: 'Site Nexus CRM · Contratação online',
    lead_notes: `Plano escolhido no site: ${plan.name}.`,
  });
  if (saleError) return json(request, { error: 'Não foi possível iniciar a contratação.' }, 500);

  const stripe = new Stripe(stripeSecretKey, { httpClient: Stripe.createFetchHttpClient() });
  let customerId = '';

  try {
    const { data: previousCustomer } = await admin.from('nexus_sales')
      .select('provider_customer_id')
      .eq('provider', 'stripe')
      .eq('environment', environment)
      .eq('registration_number', registrationNumber)
      .not('provider_customer_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    customerId = clean(previousCustomer?.provider_customer_id, 200);

    if (!customerId) {
      const customer = await stripe.customers.create({
        name: companyName,
        email,
        phone,
        address: {
          line1: `${street}, ${streetNumber}`,
          line2: addressComplement || undefined,
          city,
          state,
          postal_code: postalCode,
          country: 'BR',
        },
        metadata: {
          nexus_sale_id: saleId,
          nexus_product_code: product.code,
          registration_type: registrationType,
          registration_number: registrationNumber,
        },
      });
      customerId = customer.id;
    }

    await admin.from('nexus_sales').update({ provider_customer_id: customerId }).eq('id', saleId);

    const commonMetadata = {
      nexus_sale_id: saleId,
      nexus_plan_id: plan.id,
      nexus_product_code: product.code,
      nexus_billing_mode: 'recurring',
      nexus_billing_cycle_months: String(plan.billing_interval_months || 1),
      nexus_checkout_amount_cents: String(plan.price_cents),
    };

    const callbackBase = `${origin}/site-captacao/preview`;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: saleId,
      success_url: `${callbackBase}?checkout=sucesso&sale=${saleId}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${callbackBase}?checkout=cancelado&sale=${saleId}`,
      metadata: commonMetadata,
      subscription_data: { metadata: commonMetadata },
      line_items: [{
        quantity: 1,
        price_data: {
          currency: String(plan.currency || 'BRL').toLowerCase(),
          unit_amount: Number(plan.price_cents),
          recurring: { interval: 'month', interval_count: Number(plan.billing_interval_months || 1) },
          product_data: {
            name: clean(plan.name, 120),
            description: clean(`${product.name} · ${companyName}`, 400),
          },
        },
      }],
    });

    if (!session.url) throw new Error('A Stripe não retornou o link do checkout.');

    await admin.from('nexus_sales').update({
      sale_status: 'checkout_created',
      provider_checkout_id: session.id,
      provider_checkout_url: session.url,
      provider_customer_id: customerId,
      last_error: null,
    }).eq('id', saleId);

    return json(request, {
      ok: true,
      saleId,
      link: session.url,
      environment,
      plan: { code: plan.code, name: plan.name, priceCents: Number(plan.price_cents) },
    });
  } catch (error) {
    const message = stripeMessage(error);
    await admin.from('nexus_sales').update({ sale_status: 'failed', last_error: message, provider_customer_id: customerId || null }).eq('id', saleId);
    console.error(JSON.stringify({ message: 'crm stripe checkout failed', saleId, detail: message }));
    return json(request, { error: 'Não foi possível iniciar o pagamento. Aguarde alguns minutos e tente novamente.' }, 502);
  }
});
