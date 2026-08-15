import { createClient } from 'npm:@supabase/supabase-js@2.112.3';

const clean = (value: unknown, size = 300) => String(value ?? '').trim().slice(0, size);
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function escapeHtml(value: unknown) {
  return clean(value, 4000)
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

const json = (request: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders(request), 'Content-Type': 'application/json' },
});

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

function createProtocol() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `SUP-${date}-${suffix}`;
}

async function resolveAuthenticatedContext(admin: any, request: Request) {
  const authorization = clean(request.headers.get('authorization'), 5000);
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return null;

  const { data: { user }, error: userError } = await admin.auth.getUser(match[1]);
  if (userError || !user?.id) return null;

  const { data: profile } = await admin
    .from('profiles')
    .select('organization_id,full_name,active')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile?.active) return null;

  let organizationName = '';
  if (profile.organization_id) {
    const { data: organization } = await admin
      .from('organizations')
      .select('name')
      .eq('id', profile.organization_id)
      .maybeSingle();
    organizationName = clean(organization?.name, 180);
  }

  return {
    userId: user.id,
    organizationId: profile.organization_id || null,
    organizationName,
    name: clean(profile.full_name, 180) || clean(user.email, 180),
    email: clean(user.email, 254).toLowerCase(),
  };
}

async function sendSupportNotification(ticket: any) {
  const apiKey = Deno.env.get('BREVO_API_KEY');
  const fromEmail = Deno.env.get('BREVO_FROM_EMAIL');
  const supportEmail = Deno.env.get('NEXUS_SUPPORT_EMAIL') || 'suporte@nexuscore.app.br';
  if (!apiKey || !fromEmail || !supportEmail) return { ok: false, skipped: true };

  const subject = `${ticket.protocol} · Novo chamado de suporte`;
  const html = `
    <div style="font-family:Arial,sans-serif;color:#172026;line-height:1.55">
      <h2>Novo chamado de suporte</h2>
      <p><strong>Protocolo:</strong> ${escapeHtml(ticket.protocol)}</p>
      <p><strong>Origem:</strong> ${escapeHtml(ticket.source)}</p>
      <p><strong>Empresa:</strong> ${escapeHtml(ticket.organization_name || 'Site público / não vinculada')}</p>
      <p><strong>Solicitante:</strong> ${escapeHtml(ticket.requester_name)}</p>
      <p><strong>E-mail:</strong> ${escapeHtml(ticket.requester_email)}</p>
      <p><strong>Página:</strong> ${escapeHtml(ticket.page_url || 'Não informada')}</p>
      <div style="margin-top:18px;padding:14px;border:1px solid #d7dde1;border-radius:8px;background:#f7f9fa;white-space:pre-wrap">${escapeHtml(ticket.message)}</div>
      <p style="color:#6b7479;font-size:12px">Registro automático da Central de Suporte Nexus.</p>
    </div>`;

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'Nexus Core', email: fromEmail },
      to: [{ email: supportEmail, name: 'Suporte Nexus Core' }],
      replyTo: { email: ticket.requester_email, name: ticket.requester_name },
      subject,
      htmlContent: html,
    }),
  });

  return { ok: response.ok, skipped: false };
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return json(request, { error: 'Método não permitido.' }, 405);
  if (!originAllowed(request)) return json(request, { error: 'Origem não autorizada.' }, 403);

  const contentType = clean(request.headers.get('content-type'), 100).toLowerCase();
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (!contentType.includes('application/json')) return json(request, { error: 'Conteúdo não suportado.' }, 415);
  if (Number.isFinite(contentLength) && contentLength > 32_768) return json(request, { error: 'Requisição muito grande.' }, 413);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json(request, { error: 'Integração Nexus não configurada.' }, 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  let body: Record<string, any> = {};
  try { body = await request.json(); } catch { return json(request, { error: 'Corpo da requisição inválido.' }, 400); }

  const honeypot = clean(body.website, 120);
  if (honeypot) return json(request, { ok: true });

  try {
    const fingerprint = await hmacHex(serviceRoleKey, `support:${clientAddress(request)}`);
    const { data, error } = await admin.rpc('consume_nexus_public_request_limit', {
      p_fingerprint_hash: fingerprint,
      p_action: 'support',
      p_window_seconds: 3600,
      p_limit: 6,
    });
    if (error) throw error;
    if (data !== true) return json(request, { error: 'Muitas solicitações recentes. Aguarde um pouco e tente novamente.' }, 429);
  } catch (error) {
    console.error(JSON.stringify({ message: 'support rate limit unavailable', error: clean((error as any)?.message, 300) }));
    return json(request, { error: 'Serviço temporariamente indisponível.' }, 503);
  }

  const authContext = await resolveAuthenticatedContext(admin, request);
  const requesterName = authContext?.name || clean(body.name, 180);
  const requesterEmail = authContext?.email || clean(body.email, 254).toLowerCase();
  const message = clean(body.message, 4000);
  const source = clean(body.source, 80).toLowerCase() || 'nexus-web';
  const productCode = clean(body.productCode, 80).toLowerCase() || null;
  const pageTitle = clean(body.pageTitle, 300) || null;
  const referer = clean(request.headers.get('referer'), 1500);
  const pageUrl = referer || clean(body.pageUrl, 1500) || null;

  if (requesterName.length < 2 || !validEmail(requesterEmail)) {
    return json(request, { error: 'Informe seu nome e um e-mail válido.' }, 400);
  }
  if (message.length < 5) return json(request, { error: 'Descreva sua dúvida ou problema com um pouco mais de detalhe.' }, 400);

  const tenMinutesAgo = new Date(Date.now() - 10 * 60_000).toISOString();
  const { count } = await admin
    .from('support_requests')
    .select('id', { count: 'exact', head: true })
    .eq('requester_email', requesterEmail)
    .gte('created_at', tenMinutesAgo);
  if ((count || 0) >= 4) return json(request, { error: 'Muitas solicitações recentes para este e-mail. Aguarde alguns minutos.' }, 429);

  const protocol = createProtocol();
  const metadata = {
    authenticated: Boolean(authContext),
    organizationName: authContext?.organizationName || null,
    userAgent: clean(body.userAgent, 500) || null,
    viewport: clean(body.viewport, 80) || null,
  };

  const { data: ticket, error: insertError } = await admin
    .from('support_requests')
    .insert({
      protocol,
      organization_id: authContext?.organizationId || null,
      user_id: authContext?.userId || null,
      requester_name: requesterName,
      requester_email: requesterEmail,
      source,
      product_code: productCode,
      page_url: pageUrl,
      page_title: pageTitle,
      message,
      status: 'open',
      metadata,
    })
    .select('id,protocol,organization_id,requester_name,requester_email,source,page_url,message')
    .single();

  if (insertError || !ticket) {
    console.error(JSON.stringify({ message: 'support request insert failed', error: clean(insertError?.message, 300) }));
    return json(request, { error: 'Não foi possível registrar sua solicitação.' }, 500);
  }

  try {
    await sendSupportNotification({ ...ticket, organization_name: authContext?.organizationName || null });
  } catch (error) {
    console.error(JSON.stringify({ message: 'support email notification failed', protocol, error: clean((error as any)?.message, 300) }));
  }

  return json(request, { ok: true, protocol: ticket.protocol });
});
