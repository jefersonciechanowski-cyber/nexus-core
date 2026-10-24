import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import Stripe from 'npm:stripe@22.1.1';
import { clean, normalizeCheckout, planIsMonthly, checkoutFeatureMode, CRM_PUBLIC_ORIGIN } from './contract.mjs';
import { verifyCheckoutBridgeSignature } from './signature.mjs';

// Public interface exposed by the CRM's signed server-side proxy.
// Intentionally uses a distinct endpoint, leaving old 410 services untouched.
// Default OFF. No courtesy/agency grant paths are modified here.
function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
function getEnv(name: string) { return Deno.env.get(name) || ''; }
async function hmacBytes(secret: string, message: string) {
  const bytes = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', bytes.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const signed = await crypto.subtle.sign('HMAC', key, bytes.encode(message));
  return new Uint8Array(signed);
}
async function verifyProxySignature(raw: string, request: Request, secret: string) {
  return verifyCheckoutBridgeSignature(
    raw,
    request.headers.get('x-nexus-checkout-timestamp'),
    request.headers.get('x-nexus-checkout-signature'),
    secret,
  );
}
async function limitedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      if (!part.value) continue;
      size += part.value.length;
      if (size > 16_384) return null;
      chunks.push(part.value);
    }
    const merged = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder('utf-8', { fatal: true }).decode(merged);
  } catch { return null; } finally { try { reader.releaseLock(); } catch { /* none */ } }
}
async function hashReference(secret: string, input: string) {
  return Array.from(await hmacBytes(secret, input)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function existingCheckoutResponse(sale: any) {
  if (sale.sale_status === 'paid' || sale.sale_status === 'provisioned') return reply({ error: 'Este cadastro já possui um pagamento. Entre em contato com a Nexus.' }, 409);
  if (sale.sale_status === 'checkout_created' && typeof sale.provider_checkout_url === 'string'
    && sale.provider_checkout_url.startsWith('https://checkout.stripe.com/')) {
    return reply({ link: sale.provider_checkout_url, checkoutId: sale.provider_checkout_id, reused: true });
  }
  return reply({ error: 'Esta contratação já está sendo preparada. Aguarde antes de tentar novamente.' }, 409);
}

Deno.serve(async request => {
  if (request.method !== 'POST') return reply({ error: 'Método não permitido.' }, 405);
  // A server-to-server signed bridge is mandatory even for test-mode checkout.
  if (request.headers.get('origin') !== CRM_PUBLIC_ORIGIN) return reply({ error: 'Origem não autorizada.' }, 403);
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return reply({ error: 'Conteúdo inválido.' }, 415);
  }
  const mode = checkoutFeatureMode({
    NEXUS_CRM_MONTHLY_CHECKOUT_ENABLED: getEnv('NEXUS_CRM_MONTHLY_CHECKOUT_ENABLED'),
    NEXUS_CRM_MONTHLY_CHECKOUT_MODE: getEnv('NEXUS_CRM_MONTHLY_CHECKOUT_MODE'),
    NEXUS_CRM_LIVE_CHECKOUT_ENABLED: getEnv('NEXUS_CRM_LIVE_CHECKOUT_ENABLED'),
    NEXUS_PAYMENT_LIVE_ENABLED: getEnv('NEXUS_PAYMENT_LIVE_ENABLED'),
    STRIPE_TEST_SECRET_KEY: getEnv('STRIPE_TEST_SECRET_KEY'),
    STRIPE_SECRET_KEY: getEnv('STRIPE_SECRET_KEY'),
  });
  if (!mode) return reply({ error: 'A contratação mensal ainda não está disponível.' }, 503);

  const supabaseUrl = getEnv('SUPABASE_URL');
  const serviceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
  const bridgeKey = getEnv('NEXUS_CRM_CHECKOUT_BRIDGE_SECRET');
  if (!supabaseUrl || !serviceRoleKey || bridgeKey.length < 32) return reply({ error: 'Checkout temporariamente indisponível.' }, 503);

  const raw = await limitedBody(request);
  if (!raw) return reply({ error: 'Dados inválidos ou muito grandes.' }, 400);
  if (!(await verifyProxySignature(raw, request, bridgeKey))) return reply({ error: 'Assinatura do pedido inválida.' }, 403);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return reply({ error: 'Dados inválidos.' }, 400); }
  const normalized = normalizeCheckout(parsed);
  if (normalized.error || !normalized.payload) return reply({ error: normalized.error || 'Dados inválidos.' }, 400);
  const input = normalized.payload;

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const requesterHash = await hashReference(serviceRoleKey, 'crm-checkout-rate:' + input.email + ':' + input.registrationNumber);
  const { data: allowed, error: limitError } = await admin.rpc('consume_nexus_public_request_limit', {
    p_fingerprint_hash: requesterHash, p_action: 'crm-monthly-checkout', p_window_seconds: 3600, p_limit: 3,
  });
  if (limitError) return reply({ error: 'Checkout temporariamente indisponível.' }, 503);
  if (allowed !== true) return reply({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, 429);

  const { data: product, error: productError } = await admin.from('nexus_products')
    .select('id').eq('code', 'crm').eq('status', 'active').maybeSingle();
  if (productError || !product?.id) return reply({ error: 'Produto indisponível.' }, 503);
  const { data: plan, error: planError } = await admin.from('nexus_plans')
    .select('id,code,name,price_cents,currency,billing_interval_months,status,public_visible')
    .eq('product_id', product.id).eq('code', input.planCode).maybeSingle();
  const testHiddenAllowed = mode === 'sandbox' && getEnv('NEXUS_CRM_CHECKOUT_TEST_ALLOW_HIDDEN_PLANS') === 'true';
  if (planError || !plan || !planIsMonthly(plan, testHiddenAllowed) || plan.currency !== 'BRL') {
    return reply({ error: 'Plano mensal indisponível para contratação.' }, 409);
  }

  // Never overwrite an existing agency courtesy or turn a trial into paid access.
  // This creates only a new pending sale. Provisioning happens on signed payment webhooks.
  const { data: recentSale, error: recentError } = await admin.from('nexus_sales')
    .select('id,provider_checkout_url,provider_checkout_id,sale_status')
    .eq('product_id', product.id).eq('plan_id', plan.id).eq('environment', mode)
    .eq('provider', 'stripe').eq('registration_number', input.registrationNumber)
    .eq('email', input.email).in('sale_status', ['checkout_created', 'paid', 'provisioned'])
    .gte('created_at', new Date(Date.now() - 24 * 3600_000).toISOString())
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (recentError) return reply({ error: 'Não foi possível verificar a contratação.' }, 503);
  if (recentSale) return existingCheckoutResponse(recentSale);

  const bucket = Math.floor(Date.now() / (24 * 3600_000));
  const reference = 'crm-monthly-' + await hashReference(serviceRoleKey,
    'v1:' + mode + ':' + input.registrationNumber + ':' + input.email + ':' + input.planCode + ':' + bucket);
  const attributes = [
    ['Oferta', 'Assinatura mensal Nexus CRM'], ['Origem UTM', input.utmSource],
    ['Mídia UTM', input.utmMedium], ['Conteúdo UTM', input.utmContent],
    ['Termo UTM', input.utmTerm], ['Referência', input.referrer],
    ['Termos', 'Aceites no formulário; comprovação operacional pendente de auditoria'],
  ].filter((entry: string[]) => entry[1]).map((entry: string[]) => entry[0] + ': ' + entry[1]).join('\n').slice(0, 1900);

  const { data: sale, error: saleError } = await admin.from('nexus_sales').insert({
    product_id: product.id, plan_id: plan.id, sale_status: 'lead',
    source: 'site-captacao', lead_stage: 'new', company_name: input.companyName,
    responsible_name: input.responsibleName, email: input.email, phone: input.phone,
    registration_number: input.registrationNumber, registration_type: input.registrationType,
    postal_code: input.postalCode, street: input.street, street_number: input.streetNumber,
    address_complement: input.addressComplement || null, district: input.district,
    city: input.city, state: input.state, campaign_name: input.utmCampaign || null,
    provider: 'stripe', environment: mode, billing_mode: 'recurring',
    billing_cycle_months: 1, checkout_amount_cents: Number(plan.price_cents),
    external_reference: reference, return_origin: CRM_PUBLIC_ORIGIN, lead_notes: attributes,
  }).select('id').single();
  if (saleError) {
    if (saleError.code === '23505') return reply({ error: 'Já existe uma contratação em andamento. Aguarde e tente novamente.' }, 409);
    console.error('crm-monthly-sale-insert-failed', saleError.code || 'unknown');
    return reply({ error: 'Não foi possível registrar a contratação.' }, 503);
  }

  const stripeKey = mode === 'production' ? getEnv('STRIPE_SECRET_KEY') : getEnv('STRIPE_TEST_SECRET_KEY');
  const methodConfig = mode === 'production'
    ? getEnv('NEXUS_CRM_CARD_PAYMENT_CONFIG_LIVE')
    : getEnv('NEXUS_CRM_CARD_PAYMENT_CONFIG_TEST');
  // Payment Method Configuration must be verified as card-only in the Stripe
  // Dashboard for the selected environment; never hard-code payment method types.
  if (!/^pmc_[A-Za-z0-9]+$/.test(methodConfig)) {
    await admin.from('nexus_sales').update({
      sale_status: 'failed', last_error: 'Configuração de pagamento mensal por cartão ausente.',
    }).eq('id', sale.id);
    return reply({ error: 'Pagamento mensal ainda não configurado.' }, 503);
  }
  const stripe = new Stripe(stripeKey, { httpClient: Stripe.createFetchHttpClient() });
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription', payment_method_configuration: methodConfig,
      customer_email: input.email,
      client_reference_id: sale.id,
      success_url: CRM_PUBLIC_ORIGIN + '/site-captacao?checkout_status=return&session_id={CHECKOUT_SESSION_ID}#planos',
      cancel_url: CRM_PUBLIC_ORIGIN + '/site-captacao?checkout_status=cancelado#planos',
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'brl',
          unit_amount: Number(plan.price_cents),
          recurring: { interval: 'month', interval_count: 1 },
          product_data: { name: clean(plan.name, 140) },
        },
      }],
      metadata: { nexus_sale_id: sale.id, nexus_product: 'crm', nexus_billing_mode: 'recurring' },
      subscription_data: { metadata: { nexus_sale_id: sale.id, nexus_product: 'crm' } },
    }, { idempotencyKey: 'crm-monthly-' + sale.id });
    if (!session.url || !session.url.startsWith('https://checkout.stripe.com/')) {
      throw new Error('Stripe Checkout URL ausente ou inválida.');
    }
    const { error: persistError } = await admin.from('nexus_sales').update({
      sale_status: 'checkout_created', provider_checkout_id: session.id,
      provider_checkout_url: session.url, updated_at: new Date().toISOString(),
    }).eq('id', sale.id);
    if (persistError) {
      console.error('crm-monthly-checkout-persistence-failed', persistError.code || 'unknown');
      return reply({ error: 'Não foi possível confirmar a criação do checkout. Contate o suporte antes de tentar novamente.' }, 503);
    }
    return reply({ link: session.url, checkoutId: session.id, mode, monthly: true });
  } catch (error) {
    await admin.from('nexus_sales').update({
      sale_status: 'failed', last_error: 'Falha ao iniciar assinatura mensal na Stripe.',
      updated_at: new Date().toISOString(),
    }).eq('id', sale.id);
    console.error('crm-monthly-stripe-checkout-failed', clean((error as any)?.code || 'provider_error', 70));
    return reply({ error: 'Não foi possível abrir o pagamento. Tente mais tarde ou contate o suporte.' }, 503);
  }
});
