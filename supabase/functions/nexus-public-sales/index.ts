import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import Stripe from 'npm:stripe@22.1.1';

const json = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
});

const clean = (value: unknown, size = 300) => String(value ?? '').trim().slice(0, size);
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const states = new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);

function escapeHtml(value: unknown) {
  return clean(value, 500)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function trustedOrigin(request: Request) {
  const fallback = (Deno.env.get('NEXUS_PUBLIC_URL') || 'https://nexuscore.app.br').replace(/\/$/, '');
  const raw = clean(request.headers.get('Origin'), 500);
  if (!raw) return fallback;
  try {
    const url = new URL(raw);
    const fallbackUrl = new URL(fallback);
    const isLocal = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    const isWorker = url.protocol === 'https:' && url.hostname.endsWith('.jefersonciechanowski.workers.dev');
    const isConfigured = url.origin === fallbackUrl.origin;
    return isLocal || isWorker || isConfigured ? url.origin : fallback;
  } catch {
    return fallback;
  }
}

function originAllowed(request: Request) {
  const raw = clean(request.headers.get('Origin'), 500);
  if (!raw) return true;
  try {
    return new URL(raw).origin === trustedOrigin(request);
  } catch {
    return false;
  }
}

function corsHeaders(request: Request) {
  return {
    'Access-Control-Allow-Origin': trustedOrigin(request),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
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

async function consumeRateLimit(admin: any, request: Request, action: string, secretMaterial: string) {
  const rules: Record<string, { windowSeconds: number; limit: number }> = {
    plans: { windowSeconds: 60, limit: 120 },
    status: { windowSeconds: 60, limit: 120 },
    lead: { windowSeconds: 3600, limit: 6 },
    checkout: { windowSeconds: 900, limit: 8 },
  };
  const rateAction = rules[action] ? action : 'invalid';
  const rule = rules[rateAction] || { windowSeconds: 60, limit: 60 };
  const fingerprint = await hmacHex(secretMaterial, `${rateAction}:${clientAddress(request)}`);
  const { data, error } = await admin.rpc('consume_nexus_public_request_limit', {
    p_fingerprint_hash: fingerprint,
    p_action: rateAction,
    p_window_seconds: rule.windowSeconds,
    p_limit: rule.limit,
  });
  if (error) throw error;
  return data === true;
}

function integrationIdentifier() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const suffix = Array.from(bytes, byte => String.fromCharCode(97 + (byte % 26))).join('');
  return `nexus_sst_${suffix}`;
}

function stripeEnvironment(secret: string | undefined) {
  return /^(?:sk|rk)_live_/.test(secret || '') ? 'production' : 'sandbox';
}

function stripeMessage(error: unknown) {
  const value = error as any;
  return clean(value?.raw?.message || value?.message || 'Não foi possível comunicar com a Stripe.', 700);
}

async function ensureBrazilTaxId(stripe: Stripe, customerId: string, registrationType: string, registrationNumber: string) {
  const taxType = registrationType === 'CNPJ' ? 'br_cnpj' : 'br_cpf';
  try {
    const existing = await stripe.customers.listTaxIds(customerId, { limit: 100 });
    const found = existing.data.some((item: any) => item.type === taxType && digits(item.value) === registrationNumber);
    if (!found) await stripe.customers.createTaxId(customerId, { type: taxType as any, value: registrationNumber });
  } catch (error) {
    throw new Error(`Não foi possível validar o CPF/CNPJ na Stripe: ${stripeMessage(error)}`);
  }
}

async function sendBrevoEmail(to: string, toName: string, subject: string, html: string) {
  const apiKey = Deno.env.get('BREVO_API_KEY');
  const fromEmail = Deno.env.get('BREVO_FROM_EMAIL');
  if (!apiKey || !fromEmail) return { ok: false, skipped: true, error: 'BREVO_API_KEY ou BREVO_FROM_EMAIL ausente.' };

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'Nexus Core', email: fromEmail },
      to: [{ email: to, name: toName || undefined }],
      subject,
      htmlContent: html,
    }),
  });

  if (!response.ok) return { ok: false, skipped: false, error: `Brevo ${response.status}: ${clean(await response.text(), 500)}` };
  return { ok: true, skipped: false, error: null };
}

async function sendLeadNotification(admin: any, sale: any, planName: string) {
  const { data: admins } = await admin.from('profiles').select('id').eq('role', 'nexus_admin').eq('active', true).limit(1);
  const profile = admins?.[0];
  if (!profile?.id) return;
  const { data: userData } = await admin.auth.admin.getUserById(profile.id);
  const recipient = userData?.user?.email;
  if (!recipient) return;

  const subject = sale.sale_status === 'checkout_created'
    ? `Nova contratação iniciada · ${clean(sale.company_name, 100)}`
    : `Novo lead Nexus SST · ${clean(sale.company_name, 100)}`;
  const billingText = sale.billing_mode === 'prepaid' ? 'Anual à vista no boleto' : 'Mensal recorrente';
  const html = `
    <div style="font-family:Arial,sans-serif;color:#172026;line-height:1.55">
      <h2>${sale.sale_status === 'checkout_created' ? 'Nova contratação iniciada' : 'Novo lead pelo site'}</h2>
      <p><strong>Empresa:</strong> ${escapeHtml(sale.company_name)}</p>
      <p><strong>Responsável:</strong> ${escapeHtml(sale.responsible_name)}</p>
      <p><strong>E-mail:</strong> ${escapeHtml(sale.email)}</p>
      <p><strong>Telefone:</strong> ${escapeHtml(sale.phone || 'Não informado')}</p>
      <p><strong>Plano:</strong> ${escapeHtml(planName || 'Não definido')}</p>
      <p><strong>Modelo:</strong> ${escapeHtml(billingText)}</p>
      <p><strong>Colaboradores:</strong> ${escapeHtml(sale.employee_count ?? 'Não informado')}</p>
      <p style="color:#6b7479;font-size:12px">Registro automático da Central Nexus.</p>
    </div>`;

  const result = await sendBrevoEmail(recipient, 'Administrador Nexus', subject, html);
  if (!result.ok && !result.skipped) console.error('Falha ao enviar notificação administrativa pela Brevo:', result.error);
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return json(request, { error: 'Método não permitido.' }, 405);
  if (!originAllowed(request)) return json(request, { error: 'Origem não autorizada.' }, 403);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json(request, { error: 'Integração Nexus não configurada.' }, 500);

  const contentType = clean(request.headers.get('content-type'), 100).toLowerCase();
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (!contentType.includes('application/json')) return json(request, { error: 'Conteúdo não suportado.' }, 415);
  if (Number.isFinite(contentLength) && contentLength > 65_536) return json(request, { error: 'Requisição muito grande.' }, 413);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const environment = stripeEnvironment(stripeSecretKey);
  let body: Record<string, any> = {};
  try { body = await request.json(); } catch { return json(request, { error: 'Corpo da requisição inválido.' }, 400); }

  const action = clean(body.action, 30).toLowerCase();
  try {
    if (!await consumeRateLimit(admin, request, action, serviceRoleKey)) {
      return json(request, { error: 'Muitas tentativas recentes. Aguarde alguns minutos e tente novamente.' }, 429);
    }
  } catch (error) {
    console.error(JSON.stringify({ message: 'public sales rate limit unavailable', action, error: clean((error as any)?.message, 300) }));
    return json(request, { error: 'Serviço temporariamente indisponível.' }, 503);
  }

  if (action === 'plans') {
    const { data: product } = await admin.from('nexus_products').select('id').eq('code', 'sst').eq('status', 'active').maybeSingle();
    if (!product?.id) return json(request, { plans: [] });
    const { data: plans, error } = await admin
      .from('nexus_plans')
      .select('code,name,description,price_cents,currency,billing_interval_months,employee_limit,sales_badge,sales_summary,sort_order')
      .eq('product_id', product.id)
      .eq('status', 'active')
      .eq('public_visible', true)
      .order('sort_order', { ascending: true });
    if (error) return json(request, { error: 'Não foi possível carregar os planos.' }, 500);
    return json(request, { plans: plans || [] });
  }

  if (action === 'status') {
    const saleId = clean(body.saleId, 80);
    if (!saleId) return json(request, { error: 'Venda não informada.' }, 400);
    const { data } = await admin.from('nexus_sales').select('sale_status').eq('id', saleId).maybeSingle();
    if (!data) return json(request, { error: 'Venda não encontrada.' }, 404);
    return json(request, { status: data.sale_status });
  }

  const companyName = clean(body.companyName, 140);
  const responsibleName = clean(body.responsibleName, 140);
  const email = clean(body.email, 180).toLowerCase();
  const phone = digits(body.phone).slice(0, 15);
  const employeeCount = Math.max(0, Math.min(1000000, Number(body.employeeCount) || 0));
  const planCode = clean(body.planCode, 80).toLowerCase();
  const honeypot = clean(body.website, 100);

  if (honeypot) return json(request, { ok: true });
  if (companyName.length < 2 || responsibleName.length < 2 || !validEmail(email)) return json(request, { error: 'Preencha empresa, responsável e e-mail válidos.' }, 400);

  const { data: product } = await admin.from('nexus_products').select('id,name,code').eq('code', 'sst').eq('status', 'active').maybeSingle();
  if (!product?.id) return json(request, { error: 'Produto indisponível.' }, 503);

  let plan: any = null;
  if (planCode) {
    const { data } = await admin
      .from('nexus_plans')
      .select('id,code,name,price_cents,currency,billing_interval_months,employee_limit,status,public_visible')
      .eq('product_id', product.id)
      .eq('code', planCode)
      .eq('status', 'active')
      .maybeSingle();
    plan = data;
  }

  if (action === 'lead') {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60_000).toISOString();
    const { count } = await admin.from('nexus_sales').select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', fifteenMinutesAgo);
    if ((count || 0) >= 3) return json(request, { ok: true });

    const { data: sale, error } = await admin.from('nexus_sales').insert({
      product_id: product.id,
      plan_id: plan?.id || null,
      sale_status: 'lead',
      source: 'site-captacao',
      company_name: companyName,
      responsible_name: responsibleName,
      email,
      phone: phone || null,
      employee_count: employeeCount || null,
      provider: 'stripe',
      environment,
      billing_mode: 'recurring',
      billing_cycle_months: Number(plan?.billing_interval_months || 1),
      checkout_amount_cents: plan?.price_cents || null,
    }).select('id,company_name,responsible_name,email,phone,employee_count,sale_status,billing_mode').single();
    if (error || !sale) return json(request, { error: 'Não foi possível registrar seu interesse.' }, 500);

    await sendLeadNotification(admin, sale, plan?.name || planCode);
    return json(request, { ok: true, saleId: sale.id });
  }

  if (action !== 'checkout') return json(request, { error: 'Ação inválida.' }, 400);
  if (!stripeSecretKey) return json(request, { error: 'Checkout temporariamente indisponível.' }, 503);
  if (!body.acceptedTerms) return json(request, { error: 'Confirme os dados e a cobrança para continuar.' }, 400);
  if (!plan?.id || !plan.public_visible || Number(plan.price_cents) <= 0) return json(request, { error: 'Este plano exige atendimento comercial.' }, 409);
  if (plan.employee_limit && employeeCount > Number(plan.employee_limit)) return json(request, { error: 'A quantidade de colaboradores informada ultrapassa o limite deste plano.' }, 409);

  const billingChoice = clean(body.billingChoice, 30).toLowerCase() || 'monthly';
  if (!['monthly','annual_boleto'].includes(billingChoice)) return json(request, { error: 'Modelo de cobrança inválido.' }, 400);
  const annualPrepaid = billingChoice === 'annual_boleto';
  const billingMode = annualPrepaid ? 'prepaid' : 'recurring';
  const billingCycleMonths = annualPrepaid ? 12 : Number(plan.billing_interval_months || 1);
  const checkoutAmountCents = annualPrepaid ? Number(plan.price_cents) * 10 : Number(plan.price_cents);
  const annualPaymentMethodConfiguration = Deno.env.get(
    environment === 'production'
      ? 'STRIPE_ANNUAL_PAYMENT_METHOD_CONFIGURATION_LIVE'
      : 'STRIPE_ANNUAL_PAYMENT_METHOD_CONFIGURATION_TEST'
  );
  if (annualPrepaid && !annualPaymentMethodConfiguration) {
    return json(request, { error: 'Boleto anual temporariamente indisponível.' }, 503);
  }

  const registrationNumber = digits(body.registrationNumber);
  const registrationType = registrationNumber.length === 14 ? 'CNPJ' : registrationNumber.length === 11 ? 'CPF' : '';
  const postalCode = digits(body.postalCode);
  const street = clean(body.street, 140);
  const streetNumber = clean(body.streetNumber, 40);
  const addressComplement = clean(body.addressComplement, 160);
  const district = clean(body.district, 100);
  const city = clean(body.city, 100);
  const state = clean(body.state, 2).toUpperCase();

  if (!registrationType) return json(request, { error: 'Informe um CPF ou CNPJ válido.' }, 400);
  if (phone.length < 10) return json(request, { error: 'Informe um telefone válido.' }, 400);
  if (postalCode.length !== 8 || !street || !streetNumber || !district || !city || !states.has(state)) return json(request, { error: 'Preencha o endereço completo para gerar a cobrança.' }, 400);

  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const [{ count: recentEmail }, { count: recentRegistration }] = await Promise.all([
    admin.from('nexus_sales').select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', tenMinutesAgo),
    admin.from('nexus_sales').select('id', { count: 'exact', head: true }).eq('registration_number', registrationNumber).gte('created_at', tenMinutesAgo),
  ]);
  if ((recentEmail || 0) >= 5 || (recentRegistration || 0) >= 5) return json(request, { error: 'Muitas tentativas recentes. Aguarde alguns minutos e tente novamente.' }, 429);

  const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
  const { data: reusable } = await admin.from('nexus_sales')
    .select('id,provider_checkout_url')
    .eq('provider', 'stripe')
    .eq('environment', environment)
    .eq('email', email)
    .eq('registration_number', registrationNumber)
    .eq('plan_id', plan.id)
    .eq('billing_mode', billingMode)
    .eq('billing_cycle_months', billingCycleMonths)
    .eq('sale_status', 'checkout_created')
    .gte('created_at', oneHourAgo)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (reusable?.provider_checkout_url) return json(request, { saleId: reusable.id, link: reusable.provider_checkout_url, reused: true, environment, billingMode });

  const saleId = crypto.randomUUID();
  const externalReference = `nexus-sale-${saleId}`;
  const origin = trustedOrigin(request);

  const { error: saleInsertError } = await admin.from('nexus_sales').insert({
    id: saleId,
    product_id: product.id,
    plan_id: plan.id,
    sale_status: 'lead',
    source: 'site-captacao',
    company_name: companyName,
    registration_type: registrationType,
    registration_number: registrationNumber,
    responsible_name: responsibleName,
    email,
    phone,
    employee_count: employeeCount || null,
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
    billing_mode: billingMode,
    billing_cycle_months: billingCycleMonths,
    checkout_amount_cents: checkoutAmountCents,
  });
  if (saleInsertError) return json(request, { error: 'Não foi possível iniciar a contratação.' }, 500);

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
          nexus_source: 'site-captacao',
          registration_type: registrationType,
          registration_number: registrationNumber,
        },
      });
      customerId = customer.id;
    }

    await ensureBrazilTaxId(stripe, customerId, registrationType, registrationNumber);
    await admin.from('nexus_sales').update({ provider_customer_id: customerId }).eq('id', saleId);

    const callback = `${origin}/apps/site-captacao/obrigado.html?venda=${saleId}`;
    const commonMetadata = {
      nexus_sale_id: saleId,
      nexus_plan_id: plan.id,
      nexus_product_code: product.code,
      nexus_billing_mode: billingMode,
      nexus_billing_cycle_months: String(billingCycleMonths),
      nexus_checkout_amount_cents: String(checkoutAmountCents),
    };

    const sessionParams: any = {
      customer: customerId,
      client_reference_id: saleId,
      success_url: `${callback}&resultado=sucesso&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${callback}&resultado=cancelado`,
      metadata: commonMetadata,
      integration_identifier: integrationIdentifier(),
    };

    if (annualPrepaid) {
      sessionParams.mode = 'payment';
      sessionParams.payment_method_configuration = annualPaymentMethodConfiguration;
      sessionParams.payment_method_options = { boleto: { expires_after_days: 3 } };
      sessionParams.line_items = [{
        quantity: 1,
        price_data: {
          currency: String(plan.currency || 'BRL').toLowerCase(),
          unit_amount: checkoutAmountCents,
          product_data: {
            name: `${clean(plan.name, 100)} · Anual à vista`,
            description: clean(`${product.name} · 12 meses · 2 meses de economia · ${companyName}`, 400),
          },
        },
      }];
    } else {
      sessionParams.mode = 'subscription';
      sessionParams.line_items = [{
        quantity: 1,
        price_data: {
          currency: String(plan.currency || 'BRL').toLowerCase(),
          unit_amount: checkoutAmountCents,
          recurring: { interval: 'month', interval_count: billingCycleMonths },
          product_data: {
            name: clean(plan.name, 120),
            description: clean(`${product.name} · ${companyName}`, 400),
          },
        },
      }];
      sessionParams.subscription_data = { metadata: commonMetadata };
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    if (!session.url) throw new Error('A Stripe não retornou o link do checkout.');

    const { data: saved } = await admin.from('nexus_sales').update({
      sale_status: 'checkout_created',
      provider_customer_id: customerId,
      provider_checkout_id: session.id,
      provider_checkout_url: session.url,
      last_error: null,
    }).eq('id', saleId).select('id,company_name,responsible_name,email,phone,employee_count,sale_status,billing_mode').single();

    if (saved) await sendLeadNotification(admin, saved, plan.name);
    return json(request, { saleId, link: session.url, environment, provider: 'stripe', billingMode, amountCents: checkoutAmountCents });
  } catch (error) {
    const message = stripeMessage(error);
    await admin.from('nexus_sales').update({ sale_status: 'failed', provider_customer_id: customerId || null, last_error: message }).eq('id', saleId);
    console.error(JSON.stringify({
      message: 'stripe checkout failed',
      saleId,
      code: clean((error as any)?.code, 100),
      type: clean((error as any)?.type, 100),
      requestId: clean((error as any)?.requestId, 150),
    }));
    return json(request, { error: 'Não foi possível iniciar o pagamento. Aguarde alguns minutos e tente novamente.' }, 502);
  }
});
