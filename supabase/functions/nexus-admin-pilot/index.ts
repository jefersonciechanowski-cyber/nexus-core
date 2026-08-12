import { createClient } from 'npm:@supabase/supabase-js@2';

const clean = (value: unknown, size = 300) => String(value ?? '').trim().slice(0, size);
const digits = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

function escapeHtml(value: unknown) {
  return clean(value, 500)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  };
}

async function findUserByEmail(admin: any, email: string) {
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const found = data?.users?.find((user: any) => String(user.email || '').toLowerCase() === email);
    if (found) return found;
    if (!data?.users?.length || data.users.length < 200) break;
  }
  return null;
}

async function sendBrevoEmail(email: string, responsibleName: string, subject: string, htmlContent: string) {
  const brevoKey = Deno.env.get('BREVO_API_KEY');
  const fromEmail = Deno.env.get('BREVO_FROM_EMAIL');
  if (!brevoKey || !fromEmail) return { sent: false, reason: 'Brevo não configurada.' };

  const result = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': brevoKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'Nexus Core', email: fromEmail },
      to: [{ email, name: responsibleName || undefined }],
      subject,
      htmlContent,
    }),
  });

  if (!result.ok) return { sent: false, reason: `Brevo ${result.status}: ${clean(await result.text(), 500)}` };
  return { sent: true, reason: null };
}

async function sendFirstAccessEmail(admin: any, email: string, responsibleName: string, companyName: string, validUntil: string) {
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({ type: 'recovery', email });
  const tokenHash = clean(linkData?.properties?.hashed_token, 1000);
  if (linkError || !tokenHash) return { sent: false, reason: linkError?.message || 'Não foi possível gerar o primeiro acesso.' };

  const publicUrl = (Deno.env.get('NEXUS_PUBLIC_URL') || 'https://nexuscore.app.br').replace(/\/$/, '');
  const firstAccessLink = `${publicUrl}/apps/portal-cliente/redefinir-senha.html?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`;
  const validDate = new Date(`${validUntil}T12:00:00`).toLocaleDateString('pt-BR');
  const html = `
    <div style="font-family:Arial,sans-serif;color:#182126;line-height:1.6;max-width:620px;margin:auto">
      <h2 style="margin-bottom:8px">Seu acesso piloto ao Nexus SST está pronto</h2>
      <p>Olá, ${escapeHtml(responsibleName)}.</p>
      <p>A empresa <strong>${escapeHtml(companyName)}</strong> recebeu um acesso de cortesia ao <strong>Nexus SST</strong> para validação técnica.</p>
      <p>O piloto fica disponível até <strong>${escapeHtml(validDate)}</strong>. Você terá acesso aos módulos do sistema dentro de uma empresa exclusiva e isolada.</p>
      <p>Para começar, defina sua senha pessoal:</p>
      <p style="margin:28px 0"><a href="${firstAccessLink}" style="display:inline-block;background:#d9a62d;color:#181207;padding:13px 20px;border-radius:7px;text-decoration:none;font-weight:700">Definir minha senha</a></p>
      <p style="font-size:13px;color:#68757b">Você também receberá um segundo e-mail separado com o endereço permanente da sua Central Nexus. Guarde esse e-mail para os próximos acessos.</p>
      <hr style="border:0;border-top:1px solid #d9dee1;margin:26px 0">
      <p style="font-size:12px;color:#7b858a">Nexus Core · suporte@nexuscore.app.br</p>
    </div>`;

  return sendBrevoEmail(email, responsibleName, 'Seu acesso piloto ao Nexus SST está pronto', html);
}

async function sendPermanentAccessEmail(email: string, responsibleName: string, companyName: string, validUntil: string) {
  const publicUrl = (Deno.env.get('NEXUS_PUBLIC_URL') || 'https://nexuscore.app.br').replace(/\/$/, '');
  const portalUrl = `${publicUrl}/apps/portal-cliente/login.html`;
  const validDate = new Date(`${validUntil}T12:00:00`).toLocaleDateString('pt-BR');
  const html = `
    <div style="font-family:Arial,sans-serif;color:#182126;line-height:1.6;max-width:620px;margin:auto">
      <h2 style="margin-bottom:8px">Seu endereço de acesso ao Nexus SST</h2>
      <p>Olá, ${escapeHtml(responsibleName)}.</p>
      <p>Seu acesso da empresa <strong>${escapeHtml(companyName)}</strong> está liberado até <strong>${escapeHtml(validDate)}</strong>.</p>
      <p>Use sempre a <strong>Minha Central Nexus</strong> para entrar no Nexus SST. Recomendamos guardar este e-mail ou adicionar a página aos favoritos do navegador.</p>
      <p style="margin:28px 0"><a href="${portalUrl}" style="display:inline-block;background:#d9a62d;color:#181207;padding:13px 20px;border-radius:7px;text-decoration:none;font-weight:700">Acessar Minha Central Nexus</a></p>
      <p style="font-size:13px;color:#68757b">Endereço permanente: <a href="${portalUrl}" style="color:#a67b17">${portalUrl}</a></p>
      <p style="font-size:13px;color:#68757b">Na Central, clique em <strong>Acessar sistema</strong> para abrir o Nexus SST.</p>
      <hr style="border:0;border-top:1px solid #d9dee1;margin:26px 0">
      <p style="font-size:12px;color:#7b858a">Nexus Core · suporte@nexuscore.app.br</p>
    </div>`;

  return sendBrevoEmail(email, responsibleName, 'Nexus SST — guarde seu link de acesso', html);
}

Deno.serve(async request => {
  const origin = allowedOrigin(request);
  const corsOrigin = origin || 'https://nexuscore.app.br';
  if (request.method === 'OPTIONS') {
    if (!origin) return new Response(null, { status: 403, headers: responseHeaders(corsOrigin) });
    return new Response(null, { status: 204, headers: responseHeaders(corsOrigin) });
  }

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: responseHeaders(corsOrigin) });
  if (!origin) return json({ error: 'Origem não permitida.' }, 403);
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const authorization = request.headers.get('Authorization');
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) return json({ error: 'Integração Nexus não configurada.' }, 500);

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'Sessão inválida.' }, 401);

  const { data: adminProfile, error: profileError } = await admin
    .from('profiles')
    .select('id,role,active')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError || !adminProfile?.active || adminProfile.role !== 'nexus_admin') {
    return json({ error: 'Apenas a administração Nexus pode criar acessos piloto.' }, 403);
  }

  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { return json({ error: 'Corpo da requisição inválido.' }, 400); }

  const companyName = clean(body.companyName, 160);
  const responsibleName = clean(body.responsibleName, 160);
  const email = clean(body.email, 255).toLowerCase();
  const phone = digits(body.phone).slice(0, 15);
  const days = Math.trunc(Number(body.days || 30));

  if (companyName.length < 2) return json({ error: 'Informe o nome da empresa.' }, 400);
  if (responsibleName.length < 2) return json({ error: 'Informe o nome do responsável.' }, 400);
  if (!validEmail(email)) return json({ error: 'Informe um e-mail válido.' }, 400);
  if (!Number.isInteger(days) || days < 1 || days > 90) return json({ error: 'A duração do piloto deve ficar entre 1 e 90 dias.' }, 400);
  if (phone && phone.length < 10) return json({ error: 'Informe um telefone válido ou deixe o campo vazio.' }, 400);

  let pilotUser: any = null;
  let createdAuthUser = false;

  try {
    pilotUser = await findUserByEmail(admin, email);
    if (pilotUser?.id) {
      const { data: existingProfile } = await admin.from('profiles').select('id,organization_id').eq('id', pilotUser.id).maybeSingle();
      if (existingProfile?.id) return json({ error: 'Este e-mail já possui acesso ao Nexus. Use outro e-mail para criar uma empresa piloto isolada.' }, 409);
    } else {
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { full_name: responsibleName, source: 'nexus-pilot' },
      });
      if (createError || !created?.user?.id) throw createError || new Error('Não foi possível criar o usuário do piloto.');
      pilotUser = created.user;
      createdAuthUser = true;
    }

    const { data: provisioned, error: provisionError } = await admin.rpc('provision_nexus_pilot', {
      p_user_id: pilotUser.id,
      p_created_by: user.id,
      p_company_name: companyName,
      p_responsible_name: responsibleName,
      p_email: email,
      p_phone: phone || null,
      p_days: days,
    });

    if (provisionError || !provisioned?.organizationId) {
      if (createdAuthUser) await admin.auth.admin.deleteUser(pilotUser.id).catch(() => undefined);
      return json({ error: provisionError?.message || 'Não foi possível provisionar o acesso piloto.' }, 500);
    }

    const firstEmail = await sendFirstAccessEmail(admin, email, responsibleName, companyName, provisioned.validUntil);
    if (!firstEmail.sent) console.error('[Nexus pilot] Primeiro acesso não enviado:', firstEmail.reason);

    const permanentEmail = await sendPermanentAccessEmail(email, responsibleName, companyName, provisioned.validUntil);
    if (!permanentEmail.sent) console.error('[Nexus pilot] E-mail permanente não enviado:', permanentEmail.reason);

    return json({
      ok: true,
      organizationId: provisioned.organizationId,
      accessId: provisioned.accessId,
      validUntil: provisioned.validUntil,
      email,
      emailSent: firstEmail.sent,
      emailError: firstEmail.sent ? null : firstEmail.reason,
      permanentEmailSent: permanentEmail.sent,
      permanentEmailError: permanentEmail.sent ? null : permanentEmail.reason,
    });
  } catch (error) {
    if (createdAuthUser && pilotUser?.id) await admin.auth.admin.deleteUser(pilotUser.id).catch(() => undefined);
    console.error('[Nexus pilot]', error);
    return json({ error: clean((error as any)?.message || 'Não foi possível criar o acesso piloto.', 700) }, 500);
  }
});
