import { createClient } from 'npm:@supabase/supabase-js@2.112.3';

const clean = (value: unknown, size = 300) => String(value ?? '').trim().slice(0, size);
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

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
    const vercelPreview = url.protocol === 'https:' && hostname.endsWith('.vercel.app') && hostname.includes('nexus-crm');
    return local || nexusCore || vercelPreview;
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

async function consumeRateLimit(admin: any, request: Request, secretMaterial: string) {
  const fingerprint = await hmacHex(secretMaterial, `crm-demo:${clientAddress(request)}`);
  const { data, error } = await admin.rpc('consume_nexus_public_request_limit', {
    p_fingerprint_hash: fingerprint,
    p_action: 'crm-demo',
    p_window_seconds: 3600,
    p_limit: 6,
  });
  if (error) throw error;
  return data === true;
}

async function resolveCrmProduct(admin: any) {
  for (const code of ['crm', 'nexus-crm', 'nexus_crm']) {
    const { data } = await admin
      .from('nexus_products')
      .select('id,name,code')
      .eq('code', code)
      .eq('status', 'active')
      .maybeSingle();
    if (data?.id) return data;
  }

  const { data } = await admin
    .from('nexus_products')
    .select('id,name,code')
    .eq('status', 'active')
    .ilike('name', '%CRM%')
    .limit(1)
    .maybeSingle();

  return data?.id ? data : null;
}

async function resolvePlan(admin: any, productId: string, planCode: string) {
  if (!planCode) return null;

  const aliases: Record<string, string[]> = {
    start: ['start', 'crm-start', 'nexus-crm-start'],
    pro: ['pro', 'crm-pro', 'nexus-crm-pro'],
    gestao: ['gestao', 'gestão', 'crm-gestao', 'nexus-crm-gestao'],
  };

  for (const code of aliases[planCode] || [planCode]) {
    const { data } = await admin
      .from('nexus_plans')
      .select('id,name,code,price_cents,billing_interval_months')
      .eq('product_id', productId)
      .eq('status', 'active')
      .eq('code', code)
      .maybeSingle();
    if (data?.id) return data;
  }

  const planName = planCode === 'gestao' ? 'Gestão' : planCode === 'pro' ? 'Pro' : 'Start';
  const { data } = await admin
    .from('nexus_plans')
    .select('id,name,code,price_cents,billing_interval_months')
    .eq('product_id', productId)
    .eq('status', 'active')
    .ilike('name', `%${planName}%`)
    .limit(1)
    .maybeSingle();

  return data?.id ? data : null;
}

async function sendBrevoEmail(to: string, subject: string, html: string) {
  const apiKey = Deno.env.get('BREVO_API_KEY');
  const fromEmail = Deno.env.get('BREVO_FROM_EMAIL');
  if (!apiKey || !fromEmail) return;

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'Nexus Core', email: fromEmail },
      to: [{ email: to, name: 'Administrador Nexus' }],
      subject,
      htmlContent: html,
    }),
  });

  if (!response.ok) {
    console.error('Falha ao enviar aviso de lead CRM pela Brevo:', response.status, clean(await response.text(), 400));
  }
}

async function notifyAdmin(admin: any, sale: any, planName: string) {
  const { data: admins } = await admin
    .from('profiles')
    .select('id')
    .eq('role', 'nexus_admin')
    .eq('active', true)
    .limit(1);

  const profile = admins?.[0];
  if (!profile?.id) return;

  const { data: userData } = await admin.auth.admin.getUserById(profile.id);
  const recipient = clean(userData?.user?.email, 180);
  if (!recipient) return;

  const safe = (value: unknown) => clean(value, 500)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  await sendBrevoEmail(
    recipient,
    `Novo lead Nexus CRM · ${clean(sale.company_name, 100)}`,
    `<div style="font-family:Arial,sans-serif;color:#172026;line-height:1.55">
      <h2>Nova solicitação de demonstração do Nexus CRM</h2>
      <p><strong>Empresa:</strong> ${safe(sale.company_name)}</p>
      <p><strong>Responsável:</strong> ${safe(sale.responsible_name)}</p>
      <p><strong>E-mail:</strong> ${safe(sale.email)}</p>
      <p><strong>Telefone:</strong> ${safe(sale.phone || 'Não informado')}</p>
      <p><strong>Pessoas na equipe:</strong> ${safe(sale.employee_count ?? 'Não informado')}</p>
      <p><strong>Plano de interesse:</strong> ${safe(planName || 'Não definido')}</p>
      <p style="color:#6b7479;font-size:12px">Registro automático no CRM Comercial da Central Nexus.</p>
    </div>`,
  );
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return json(request, { error: 'Método não permitido.' }, 405);
  if (!allowedOrigin(request)) return json(request, { error: 'Origem não autorizada.' }, 403);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json(request, { error: 'Integração Nexus não configurada.' }, 500);

  const contentType = clean(request.headers.get('content-type'), 100).toLowerCase();
  if (!contentType.includes('application/json')) return json(request, { error: 'Conteúdo não suportado.' }, 415);

  let body: Record<string, any> = {};
  try {
    body = await request.json();
  } catch {
    return json(request, { error: 'Corpo da requisição inválido.' }, 400);
  }

  const companyName = clean(body.companyName, 140);
  const responsibleName = clean(body.responsibleName, 140);
  const email = clean(body.email, 180).toLowerCase();
  const phone = digits(body.phone).slice(0, 15);
  const teamSize = Math.max(0, Math.min(10000, Number(body.teamSize) || 0));
  const planCode = clean(body.planCode, 80).toLowerCase();
  const honeypot = clean(body.website, 100);

  if (honeypot) return json(request, { ok: true });
  if (companyName.length < 2 || responsibleName.length < 2 || !validEmail(email) || phone.length < 10) {
    return json(request, { error: 'Preencha empresa, responsável, e-mail e telefone válidos.' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    if (!await consumeRateLimit(admin, request, serviceRoleKey)) {
      return json(request, { error: 'Muitas tentativas recentes. Aguarde alguns minutos e tente novamente.' }, 429);
    }
  } catch (error) {
    console.error('Rate limit do lead CRM indisponível:', clean((error as any)?.message, 300));
    return json(request, { error: 'Serviço temporariamente indisponível.' }, 503);
  }

  const product = await resolveCrmProduct(admin);
  if (!product?.id) return json(request, { error: 'Produto Nexus CRM não encontrado na Central.' }, 503);

  const plan = await resolvePlan(admin, product.id, planCode);
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count } = await admin
    .from('nexus_sales')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', product.id)
    .eq('email', email)
    .gte('created_at', fifteenMinutesAgo);

  if ((count || 0) >= 3) return json(request, { ok: true, duplicateSuppressed: true });

  const { data: sale, error } = await admin
    .from('nexus_sales')
    .insert({
      product_id: product.id,
      plan_id: plan?.id || null,
      sale_status: 'lead',
      source: 'site-captacao',
      company_name: companyName,
      responsible_name: responsibleName,
      email,
      phone,
      employee_count: teamSize || null,
      lead_stage: 'new',
      campaign_name: 'Site Nexus CRM · Solicitação de demonstração',
      lead_notes: planCode ? `Plano de interesse informado no site: ${plan?.name || planCode}.` : 'Solicitação de demonstração pelo site do Nexus CRM.',
    })
    .select('id,company_name,responsible_name,email,phone,employee_count,sale_status')
    .single();

  if (error || !sale) {
    console.error('Falha ao registrar lead Nexus CRM:', clean(error?.message, 400));
    return json(request, { error: 'Não foi possível registrar sua solicitação.' }, 500);
  }

  await notifyAdmin(admin, sale, plan?.name || planCode);
  return json(request, { ok: true, saleId: sale.id });
});
