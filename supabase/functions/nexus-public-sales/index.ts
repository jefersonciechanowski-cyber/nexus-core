import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@22.1.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
  const fallback = (Deno.env.get('NEXUS_PUBLIC_URL') || 'https://nexus-core.jefersonciechanowski.workers.dev').replace(/\/$/, '');
  const raw = clean(request.headers.get('Origin'), 500);
  if (!raw) return fallback;
  try {
    const url = new URL(raw);
    const isLocal = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname);
    const isWorker = url.protocol === 'https:' && url.hostname.endsWith('.jefersonciechanowski.workers.dev');
    return isLocal || isWorker ? url.origin : fallback;
  } catch {
    return fallback;
  }
}

function stripeEnvironment(secret: string | undefined) {
  return secret?.startsWith('sk_live_') ? 'production' : 'sandbox';
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

async function sendLeadNotification(admin: any, sale: any, planName: string) {
  const resendKey = Deno.env.get('RESEND_API_KEY');
  const fromEmail = Deno.env.get('RESEND_FROM_EMAIL');
  if (!resendKey || !fromEmail) return;

  const { data: admins } = await admin.from('profiles').select('id').eq('role', 'nexus_admin').eq('active', true).limit(1);
  const profile = admins?.[0];
  if (!profile?.id) return;
  const { data: userData } = await admin.auth.admin.getUserById(profile.id);
  const recipient = userData?.user?.email;
  if (!recipient) return;

  const subject = sale.sale_status === 'checkout_created'
    ? `Nova contratação iniciada · ${clean(sale.company_name, 100)}`
    : `Novo lead Nexus SST · ${clean(sale.company_name, 100)}`;
  const html = `
    <div style="font-family:Arial,sans-serif;color:#172026;line-height:1.55">
      <h2>${sale.sale_status === 'checkout_created' ? 'Nova contratação iniciada' : 'Novo lead pelo site'}</h2>
      <p><strong>Empresa:</strong> ${escapeHtml(sale.company_name)}</p>
      <p><strong>Responsável:</strong> ${escapeHtml(sale.responsible_name)}</p>
      <p><strong>E-mail:</strong> ${escapeHtml(sale.email)}</p>
      <p><strong>Telefone:</strong> ${escapeHtml(sale.phone || 'Não informado')}</p>
      <p><strong>Plano:</strong> ${escapeHtml(planName || 'Não definido')}</p>
      <p><strong>Colaboradores:</strong> ${escapeHtml(sale.employee_count ?? 'Não informado')}</p>
      <p style="color:#6b7479;font-size:12px">Registro automático da Central Nexus.</p>
    </div>`;

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: fromEmail, to: [recipient], subject, html }),
  });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json({ error: 'Integração Nexus não configurada.' }, 500);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const environment = stripeEnvironment(stripeSecretKey);
  let body: Record<string, any> = {};
  try { body = await request.json(); } catch { return json({ error: 'Corpo da requisição inválido.' }, 400); }

  const action = clean(body.action, 30).toLowerCase();

  if (action === 'plans') {
    const { data: product } = await admin.from('nexus_products').select('id').eq('code', 'sst').eq('status', 'active').maybeSingle();
    if (!product?.id) return json({ plans: [] });
    const { data: plans, error } = await admin
      .from('nexus_plans')
      .select('code,name,description,price_cents,currency,billing_interval_months,employee_limit,sales_badge,sales_summary,sort_order')
      .eq('product_id', product.id)
      .eq('status', 'active')
      .eq('public_visible', true)
      .order('sort_order', { ascending: true });
    if (error) return json({ error: 'Não foi possível carregar os planos.' }, 500);
    return json({ plans: plans || [] });
  }

  if (action === 'status') {
    const saleId = clean(body.saleId, 80);
    if (!saleId) return json({ error: 'Venda não informada.' }, 400);
    const { data } = await admin.from('nexus_sales').select('sale_status,last_error,provisioned_at').eq('id', saleId).maybeSingle();
    if (!data) return json({ error: 'Venda não encontrada.' }, 404);
    return json({ status: data.sale_status, provisioned: data.sale_status === 'provisioned', attention: data.sale_status === 'manual_review' });
  }

  const companyName = clean(body.companyName, 140);
  const responsibleName = clean(body.responsibleName, 140);
  const email = clean(body.email, 180).toLowerCase();
  const phone = digits(body.phone).slice(0, 15);
  const employeeCount = Math.max(0, Math.min(1000000, Number(body.employeeCount) || 0));
  const planCode = clean(body.planCode, 80).toLowerCase();
  const honeypot = clean(body.website, 100);

  if (honeypot) return json({ ok: true });
  if (companyName.length < 2 || responsibleName.length < 2 || !validEmail(email)) return json({ error: 'Preencha empresa, responsável e e-mail válidos.' }, 400);

  const { data: product } = await admin.from('nexus_products').select('id,name,code').eq('code', 'sst').eq('status', 'active').maybeSingle();
  if (!product?.id) return json({ error: 'Produto indisponível.' }, 503);

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
    if ((count || 0) >= 3) return json({ ok: true });

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
    }).select('id,company_name,responsible_name,email,phone,employee_count,sale_status').single();
    if (error || !sale) return json({ error: 'Não foi possível registrar seu interesse.' }, 500);

    await sendLeadNotification(admin, sale, plan?.name || planCode);
    return json({ ok: true, saleId: sale.id });
  }

  if (action !== 'checkout') return json({ error: 'Ação inválida.' }, 400);
  if (!stripeSecretKey) return json({ error: 'Checkout temporariamente indisponível.' }, 503);
  if (!body.acceptedTerms) return json({ error: 'Confirme os dados e a cobrança recorrente para continuar.' }, 400);
  if (!plan?.id || !plan.public_visible || Number(plan.price_cents) <= 0) return json({ error: 'Este plano exige atendimento comercial.' }, 409);
  if (plan.employee_limit && employeeCount > Number(plan.employee_limit)) return json({ error: 'A quantidade de colaboradores informada ultrapassa o limite deste plano.' }, 409);

  const registrationNumber = digits(body.registrationNumber);
  const registrationType = registrationNumber.length === 14 ? 'CNPJ' : registrationNumber.length === 11 ? 'CPF' : '';
  const postalCode = digits(body.postalCode);
  const street = clean(body.street, 140);
  const streetNumber = clean(body.streetNumber, 40);
  const addressComplement = clean(body.addressComplement, 160);
  const district = clean(body.district, 100);
  const city = clean(body.city, 100);
  const state = clean(body.state, 2).toUpperCase();

  if (!registrationType) return json({ error: 'Informe um CPF ou CNPJ válido.' }, 400);
  if (phone.length < 10) return json({ error: 'Informe um telefone válido.' }, 400);
  if (postalCode.length !== 8 || !street || !streetNumber || !district || !city || !states.has(state)) return json({ error: 'Preencha o endereço completo para gerar a cobrança.' }, 400);

  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const [{ count: recentEmail }, { count: recentRegistration }] = await Promise.all([
    admin.from('nexus_sales').select('id', { count: 'exact', head: true }).eq('email', email).gte('created_at', tenMinutesAgo),
    admin.from('nexus_sales').select('id', { count: 'exact', head: true }).eq('registration_number', registrationNumber).gte('created_at', tenMinutesAgo),
  ]);
  if ((recentEmail || 0) >= 5 || (recentRegistration || 0) >= 5) return json({ error: 'Muitas tentativas recentes. Aguarde alguns minutos e tente novamente.' }, 429);

  const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
  const { data: reusable } = await admin.from('nexus_sales')
    .select('id,provider_checkout_url')
    .eq('provider', 'stripe')
    .eq('environment', environment)
    .eq('email', email)
    .eq('registration_number', registrationNumber)
    .eq('plan_id', plan.id)
    .eq('sale_status', 'checkout_created')
    .gte('created_at', oneHourAgo)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (reusable?.provider_checkout_url) return json({ saleId: reusable.id, link: reusable.provider_checkout_url, reused: true, environment });

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
  });
  if (saleInsertError) return json({ error: 'Não foi possível iniciar a contratação.' }, 500);

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
    const intervalMonths = Number(plan.billing_interval_months || 1);
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: saleId,
      success_url: `${callback}&resultado=sucesso&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${callback}&resultado=cancelado`,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: String(plan.currency || 'BRL').toLowerCase(),
          unit_amount: Number(plan.price_cents),
          recurring: { interval: 'month', interval_count: intervalMonths },
          product_data: {
            name: clean(plan.name, 120),
            description: clean(`${product.name} · ${companyName}`, 400),
          },
        },
      }],
      metadata: {
        nexus_sale_id: saleId,
        nexus_plan_id: plan.id,
        nexus_product_code: product.code,
      },
      subscription_data: {
        metadata: {
          nexus_sale_id: saleId,
          nexus_plan_id: plan.id,
          nexus_product_code: product.code,
        },
      },
    });

    if (!session.url) throw new Error('A Stripe não retornou o link do checkout.');

    const { data: saved } = await admin.from('nexus_sales').update({
      sale_status: 'checkout_created',
      provider_customer_id: customerId,
      provider_checkout_id: session.id,
      provider_checkout_url: session.url,
      last_error: null,
    }).eq('id', saleId).select('id,company_name,responsible_name,email,phone,employee_count,sale_status').single();

    if (saved) await sendLeadNotification(admin, saved, plan.name);
    return json({ saleId, link: session.url, environment, provider: 'stripe' });
  } catch (error) {
    const message = stripeMessage(error);
    await admin.from('nexus_sales').update({ sale_status: 'failed', provider_customer_id: customerId || null, last_error: message }).eq('id', saleId);
    return json({ error: message }, 502);
  }
});
