import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { normalizeCheckout, planIsMonthly, CRM_PUBLIC_ORIGIN } from '../nexus-public-crm-monthly-checkout/contract.mjs';
import { verifyCheckoutBridgeSignature } from '../nexus-public-crm-monthly-checkout/signature.mjs';
import { buildCrmAsaasRecurringLink } from '../_shared/crm-asaas-monthly-contract.mjs';

// Distinct sandbox-only endpoint, no calls to legacy Asaas functions.
// Does not provision the CRM or touch courtesy access.
function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function safeAsaasUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    if (url.hostname !== 'asaas.com' && !url.hostname.endsWith('.asaas.com')) return null;
    return url.toString();
  } catch { return null; }
}

async function readJsonLimited(request: Request) {
  const length = Number(request.headers.get('content-length') || '0');
  if (!Number.isFinite(length) || length > 16384) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value?.length || 0;
      if (size > 16384) return null;
      if (part.value) chunks.push(part.value);
    }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch { return null; }
}

async function hashHex(secret: string, payload: string) {
  const e = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', e.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const result = await crypto.subtle.sign('HMAC', key, e.encode(payload));
  return Array.from(new Uint8Array(result), byte => byte.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (request: Request): Promise<Response> => {
  // HARD-OFF: never call provider, DB or provisioner until separately approved.
  const STAGED_ASAAS_DISABLED = true;
  if (STAGED_ASAAS_DISABLED) return reply({ error: 'Pix e boleto estão em homologação.' }, 503);

  if (request.method !== 'POST') return reply({ error: 'Método não permitido.' }, 405);
  if (request.headers.get('origin') !== CRM_PUBLIC_ORIGIN) return reply({ error: 'Origem não autorizada.' }, 403);
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) return reply({ error: 'Formato inválido.' }, 415);
  // No live payment link can be created by this implementation. Live requires
  // a reviewed reconciliation worker and separate deployment authorization.
  if (Deno.env.get('NEXUS_CRM_ASAAS_MONTHLY_ENABLED') !== 'true'
      || Deno.env.get('NEXUS_CRM_ASAAS_MONTHLY_MODE') !== 'sandbox') {
    return reply({ error: 'Pagamento mensal Pix/boleto ainda não disponível.' }, 503);
  }
  const asaasKey = Deno.env.get('ASAAS_SANDBOX_API_KEY') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const bridgeKey = Deno.env.get('NEXUS_CRM_CHECKOUT_BRIDGE_SECRET') || '';
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  if (asaasKey.length < 20 || serviceKey.length < 30 || bridgeKey.length < 32 || !supabaseUrl) {
    return reply({ error: 'Pagamento ainda não configurado.' }, 503);
  }
  const raw = await readJsonLimited(request);
  if (!raw) return reply({ error: 'Pedido inválido.' }, 400);
  if (!(await verifyCheckoutBridgeSignature(
    raw, request.headers.get('x-nexus-checkout-timestamp'),
    request.headers.get('x-nexus-checkout-signature'), bridgeKey,
  ))) return reply({ error: 'Pedido não autorizado.' }, 403);

  let decoded: unknown;
  try { decoded = JSON.parse(raw); } catch { return reply({ error: 'Pedido inválido.' }, 400); }
  const check = normalizeCheckout(decoded);
  if (!check.payload || check.error) return reply({ error: check.error || 'Dados inválidos.' }, 400);
  const input = check.payload;
  const method = decoded && typeof decoded === 'object' && !Array.isArray(decoded)
    ? (decoded as Record<string, unknown>).paymentMethod : null;
  if (method !== 'PIX' && method !== 'BOLETO') return reply({ error: 'Forma de pagamento inválida.' }, 400);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const requesterHash = await hashHex(serviceKey, 'crm-asaas-monthly:' + input.email + ':' + input.registrationNumber);
  const { data: allowed, error: limitError } = await admin.rpc('consume_nexus_public_request_limit', {
    p_fingerprint_hash: requesterHash, p_action: 'crm-monthly-asaas', p_window_seconds: 3600, p_limit: 3,
  });
  if (limitError) return reply({ error: 'Serviço temporariamente indisponível.' }, 503);
  if (allowed !== true) return reply({ error: 'Muitas tentativas. Tente mais tarde.' }, 429);

  const { data: product, error: productError } = await admin.from('nexus_products')
    .select('id').eq('code', 'crm').eq('status', 'active').maybeSingle();
  if (productError || !product?.id) return reply({ error: 'Produto indisponível.' }, 503);
  const { data: plan, error: planError } = await admin.from('nexus_plans')
    .select('id,code,name,price_cents,currency,billing_interval_months,status,public_visible')
    .eq('product_id', product.id).eq('code', input.planCode).maybeSingle();
  const hiddenTest = Deno.env.get('NEXUS_CRM_CHECKOUT_TEST_ALLOW_HIDDEN_PLANS') === 'true';
  if (planError || !plan || !planIsMonthly(plan, hiddenTest) || plan.currency !== 'BRL') {
    return reply({ error: 'Plano mensal indisponível.' }, 409);
  }

  // Agency courtesies, existing accounts and earlier providers are protected:
  // a public checkout cannot silently add a second subscription.
  const { data: existingOrg, error: orgError } = await admin.from('organizations')
    .select('id').eq('registration_number', input.registrationNumber).limit(1).maybeSingle();
  if (orgError) return reply({ error: 'Erro ao verificar o cadastro.' }, 503);
  if (existingOrg?.id) return reply({ error: 'Empresa já cadastrada: solicite vinculação antes de contratar.' }, 409);

  // Match Stripe's identity preflight before registering a sale or creating
  // a payment link. An e-mail already used by another Nexus product must be
  // linked through an authenticated flow, never an anonymous checkout.
  // Missing RPC/migration fails closed to avoid double subscriptions.
  const { data: identityDecision, error: identityError } = await admin.rpc(
    'preflight_nexus_crm_public_identity', {
      p_document: input.registrationNumber,
      p_email: input.email,
    },
  );
  if (identityError || identityDecision?.eligible !== true) {
    return reply({
      error: identityError
        ? 'A validação da conta está temporariamente indisponível.'
        : 'Este e-mail ou documento pode já possuir uma conta Nexus. Solicite vinculação à Central antes de pagar.',
    }, identityError ? 503 : 409);
  }

  const { data: recent, error: recentError } = await admin.from('nexus_sales')
    .select('id,sale_status').eq('product_id', product.id).eq('registration_number', input.registrationNumber)
    .eq('email', input.email).in('sale_status', ['checkout_created','paid','provisioned'])
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()).limit(1).maybeSingle();
  if (recentError) return reply({ error: 'Erro ao verificar contratação anterior.' }, 503);
  if (recent?.id) return reply({ error: 'Há uma contratação existente. Contate a Nexus antes de pagar novamente.' }, 409);

  const bucket = Math.floor(Date.now() / (24 * 60 * 60 * 1000));
  const reference = 'crm-asaas-monthly-' + await hashHex(serviceKey,
    'v1:sandbox:' + input.registrationNumber + ':' + input.email + ':' + input.planCode + ':' + method + ':' + bucket);
  const { data: sale, error: saleError } = await admin.from('nexus_sales').insert({
    product_id: product.id, plan_id: plan.id, sale_status: 'lead', lead_stage: 'new',
    source: 'site-captacao', company_name: input.companyName, responsible_name: input.responsibleName,
    email: input.email, phone: input.phone, registration_number: input.registrationNumber,
    registration_type: input.registrationType, postal_code: input.postalCode, street: input.street,
    street_number: input.streetNumber, address_complement: input.addressComplement || null,
    district: input.district, city: input.city, state: input.state,
    provider: 'asaas', environment: 'sandbox', billing_mode: 'recurring',
    billing_cycle_months: 1, checkout_amount_cents: Number(plan.price_cents),
    campaign_name: input.utmCampaign || null, external_reference: reference,
    return_origin: CRM_PUBLIC_ORIGIN, lead_notes: 'Pagamento mensal por ' + method + '; sem fidelidade anual',
  }).select('id').single();
  if (saleError) {
    if (saleError.code === '23505') return reply({ error: 'Contratação já em andamento.' }, 409);
    console.error('crm-asaas-sale-insert', String(saleError.code || 'unknown').slice(0, 30));
    return reply({ error: 'Não foi possível iniciar a contratação.' }, 503);
  }

  // Sandbox-only provider call. All pricing and subscription terms come
  // from the validated Central plan. No annual upfront charge is possible.
  const publicPlan = { ...plan, public_visible: true }; // sandbox hidden-plan waiver only
  const payload = buildCrmAsaasRecurringLink({ plan: publicPlan, method, saleId: sale.id });
  try {
    const upstream = await fetch('https://api-sandbox.asaas.com/v3/paymentLinks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'accept': 'application/json',
        'access_token': asaasKey, 'User-Agent': 'NexusCRM/1.0' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!upstream.ok) throw new Error('asaas-http-' + upstream.status);
    const result = await upstream.json();
    const link = safeAsaasUrl(result?.url);
    const linkId = typeof result?.id === 'string' && /^[A-Za-z0-9_-]{4,120}$/.test(result.id)
      ? result.id : null;
    if (!link || !linkId) throw new Error('asaas-invalid-link');

    const { error: saveError } = await admin.from('nexus_sales').update({
      sale_status: 'checkout_created', asaas_checkout_id: linkId, asaas_checkout_url: link,
      provider_checkout_id: linkId, provider_checkout_url: link, updated_at: new Date().toISOString(),
    }).eq('id', sale.id);
    if (saveError) {
      // The provider link might exist: require manual reconciliation, not retry.
      console.error('crm-asaas-link-save', String(saveError.code || 'unknown').slice(0, 30));
      return reply({ error: 'Pagamento criado, mas aguardando conferência. Contate a Nexus antes de tentar novamente.' }, 503);
    }
    return reply({ link, checkoutId: linkId, monthly: true, method, environment: 'sandbox' });
  } catch (error) {
    await admin.from('nexus_sales').update({
      sale_status: 'manual_review',
      last_error: 'Criação do link Asaas falhou ou resultado precisa de reconciliação.',
      updated_at: new Date().toISOString(),
    }).eq('id', sale.id);
    console.error('crm-asaas-checkout-failure', error instanceof Error ? error.message.slice(0, 55) : 'unknown');
    return reply({ error: 'Não foi possível confirmar o link de pagamento. Contate a Nexus antes de tentar novamente.' }, 503);
  }
});
