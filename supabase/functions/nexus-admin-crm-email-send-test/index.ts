import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { sendCrmSmtpMail } from '../stripe-webhook/crm-brevo-smtp.ts';

// Explicit, administrator-only CRM delivery test. NEVER creates access links,
// payment records, subscriptions, customers or CRM users.
// Recipient is strictly the verified auth user's email, never browser input.
const ORIGINS = new Set([
  'https://nexuscore.app.br',
  'https://www.nexuscore.app.br',
  'https://central.nexuscore.app.br',
]);
const ATTEMPT_ACTION = 'NEXUS_CRM_SMTP_SELF_TEST_ATTEMPT';
const INTERVAL_MS = 24 * 60 * 60 * 1000;

function reply(data: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'vary': 'Origin',
      'access-control-allow-origin': origin,
      'access-control-allow-headers': 'authorization, apikey, x-client-info, content-type',
      'access-control-allow-methods': 'POST, OPTIONS',
    },
  });
}

Deno.serve(async request => {
  const origin = request.headers.get('Origin') || '';
  const cors = ORIGINS.has(origin) ? origin : 'https://nexuscore.app.br';
  if (!ORIGINS.has(origin)) return reply({ error:'Origem não autorizada.' },403,cors);
  if (request.method === 'OPTIONS') return new Response(null,{
    status:204, headers:reply({},200,cors).headers,
  });
  if (request.method !== 'POST') return reply({ error:'Método não permitido.' },405,cors);
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return reply({ error:'Solicitação inválida.' },400,cors);
  }
  const length = Number(request.headers.get('content-length') || 0);
  if (!Number.isFinite(length) || length > 128) {
    return reply({error:'Solicitação inválida.'},400,cors);
  }
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > 128
      || raw.length === 0
      || !(() => {
        const body: unknown = JSON.parse(raw);
        return body !== null && typeof body === 'object' && !Array.isArray(body)
          && Object.keys(body).length === 1
          && (body as Record<string,unknown>).action === 'send_self_test';
      })()) return reply({error:'Solicitação inválida.'},400,cors);
  } catch {
    return reply({error:'Solicitação inválida.'},400,cors);
  }

  const url = Deno.env.get('SUPABASE_URL') || '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const auth = request.headers.get('Authorization') || '';
  if (!url || !anon || !service || !/^Bearer\s+\S+$/i.test(auth)) {
    return reply({error:'Sessão administrativa indisponível.'},401,cors);
  }
  const userClient = createClient(url,anon,{global:{headers:{Authorization:auth}}});
  const adminClient = createClient(url,service,{
    auth:{persistSession:false,autoRefreshToken:false},
  });
  const {data:{user},error:userError} = await userClient.auth.getUser();
  if (userError || !user) return reply({error:'Sessão inválida.'},401,cors);
  const accessToken = auth.replace(/^Bearer\s+/i,'').trim();
  const {data:level,error:levelError} =
    await userClient.auth.mfa.getAuthenticatorAssuranceLevel(accessToken);
  if (levelError || level?.currentLevel !== 'aal2') {
    return reply({error:'Confirme MFA2 na Nexus Central.'},403,cors);
  }
  const {data:profile,error:profileError} = await adminClient.from('profiles')
    .select('role,active').eq('id',user.id).maybeSingle();
  if (profileError || profile?.role !== 'nexus_admin' || profile.active !== true) {
    return reply({error:'Somente administrador Nexus autorizado.'},403,cors);
  }

  // An arbitrary email address supplied by the browser is never accepted.
  const recipient = String(user.email || '').trim().toLowerCase();
  if (recipient.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return reply({status:'admin_email_missing',emailSent:false},200,cors);
  }

  const since = new Date(Date.now() - INTERVAL_MS).toISOString();
  const {data:recent,error:recentError} = await adminClient.from('audit_logs')
    .select('id').eq('action',ATTEMPT_ACTION).eq('user_id',user.id)
    .gte('created_at',since).limit(1);
  if (recentError) return reply({status:'audit_unavailable',emailSent:false},200,cors);
  if (recent?.length) return reply({status:'already_attempted',emailSent:false},200,cors);

  // Record an attempt BEFORE sending, to avoid automatic replays after timeouts.
  // The test is limited to one attempt per admin / 24h; no recipient is logged.
  const {error:attemptError} = await adminClient.from('audit_logs').insert({
    user_id:user.id, action:ATTEMPT_ACTION,
    entity:'nexus_crm_smtp_self_test', entity_id:user.id,
    metadata:{test:'no_link_no_charge',provider:'brevo_smtp'},
  });
  if (attemptError) return reply({status:'audit_unavailable',emailSent:false},200,cors);

  const sent = await sendCrmSmtpMail({
    toEmail:recipient,
    subject:'Nexus CRM — teste de entrega de e-mail',
    htmlContent:'<div style="font-family:Arial,sans-serif;max-width:580px;line-height:1.6">'
      +'<h2>Teste de e-mail do Nexus CRM</h2>'
      +'<p>Esta é uma mensagem de homologação do envio transacional.</p>'
      +'<p>Nenhuma cobrança, assinatura, usuário ou link de primeiro acesso foi criado.</p>'
      +'<p>Nexus Core</p></div>',
    textContent:'Teste de e-mail do Nexus CRM. Esta é uma homologação do envio transacional. Nenhuma cobrança, assinatura, usuário ou link de acesso foi criado.',
  });
  try {
    await adminClient.from('audit_logs').insert({
      user_id:user.id,
      action:sent.sent?'NEXUS_CRM_SMTP_SELF_TEST_ACCEPTED':'NEXUS_CRM_SMTP_SELF_TEST_FAILED',
      entity:'nexus_crm_smtp_self_test',entity_id:user.id,
      metadata:{reason:sent.reason,provider:'brevo_smtp'},
    });
  } catch { /* No retries after a sender-accepted SMTP response. */ }
  return reply({
    status:sent.sent?'smtp_accepted':sent.reason,
    emailSent:sent.sent,
    delivered:false, // SMTP acceptance does NOT prove inbox delivery.
  },200,cors);
});
