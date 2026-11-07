import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { verifyCrmSmtp } from '../stripe-webhook/crm-brevo-smtp.ts';

// Authentication-only, no-send Brevo CRM SMTP connection check.
// Never sends messages, stores tokens, exposes customer addresses, creates
// billing records, or returns a first-access/recovery URL.
const ORIGINS = new Set([
  'https://nexuscore.app.br',
  'https://www.nexuscore.app.br',
  'https://central.nexuscore.app.br',
]);
const MAX_BODY_BYTES = 256;

function reply(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type':'application/json; charset=utf-8',
      'cache-control':'no-store',
      'x-content-type-options':'nosniff',
      'vary':'Origin',
      'access-control-allow-origin':origin,
      'access-control-allow-headers':'authorization, apikey, x-client-info, content-type',
      'access-control-allow-methods':'POST, OPTIONS',
    },
  });
}

Deno.serve(async request => {
  const origin = request.headers.get('Origin') || '';
  const cors = ORIGINS.has(origin) ? origin : 'https://nexuscore.app.br';
  if (!ORIGINS.has(origin)) return reply({error:'Origem não autorizada.'},403,cors);
  if (request.method === 'OPTIONS') return new Response(null,{
    status:204,headers:reply({},200,cors).headers,
  });
  if (request.method !== 'POST') return reply({error:'Método não permitido.'},405,cors);
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return reply({error:'Solicitação inválida.'},400,cors);
  }
  const bodyLength = Number(request.headers.get('content-length') || 0);
  if (!Number.isFinite(bodyLength) || bodyLength > MAX_BODY_BYTES) {
    return reply({error:'Solicitação inválida.'},400,cors);
  }
  let body: unknown;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
      return reply({error:'Solicitação inválida.'},400,cors);
    }
    body = JSON.parse(raw);
  } catch {
    return reply({error:'Solicitação inválida.'},400,cors);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)
    || Object.keys(body).length !== 1
    || (body as Record<string,unknown>).action !== 'check') {
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
  const adminClient = createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
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

  // SMTP VERIFY authenticates without sending any message or reading secrets
  // back to the caller. SMTP authentication does not prove sender approval.
  const smtp = await verifyCrmSmtp();
  return reply({
    status: smtp.status,
    smtpConfigured: smtp.credentialsConfigured,
    senderConfigured: smtp.senderConfigured,
    senderActive: false,
    emailSent: false,
  }, 200, cors);
});
