import { createClient } from 'npm:@supabase/supabase-js@2.112.3';

const MAX_BODY_BYTES = 16 * 1024;
const clean = (value: unknown, size = 500) => String(value ?? '').trim().slice(0, size);

function requestOrigin(request: Request) {
  return clean(request.headers.get('Origin'), 500);
}

function allowedOrigin(request: Request) {
  const raw = requestOrigin(request);
  if (!raw) return true;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    const official = url.protocol === 'https:' && (host === 'crm.nexuscore.app.br' || host === 'nexuscore.app.br' || host.endsWith('.nexuscore.app.br'));
    const local = url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(host);
    return official || local;
  } catch {
    return false;
  }
}

function corsHeaders(request: Request) {
  const raw = requestOrigin(request);
  const origin = raw && allowedOrigin(request) ? raw : 'https://crm.nexuscore.app.br';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

Deno.serve(async request => {
  if (request.method === 'OPTIONS') {
    if (!allowedOrigin(request)) return new Response(null, { status: 403, headers: corsHeaders(request) });
    return new Response(null, { status: 204, headers: corsHeaders(request) });
  }
  if (request.method !== 'POST') return json(request, { error: 'Método não permitido.' }, 405);
  if (!allowedOrigin(request)) return json(request, { error: 'Origem não autorizada.' }, 403);

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return json(request, { error: 'Payload muito grande.' }, 413);

  const authorization = request.headers.get('authorization') ?? '';
  const jwt = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  if (!jwt) return json(request, { error: 'Sessão administrativa obrigatória.' }, 401);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceRoleKey) return json(request, { error: 'Homologação não configurada.' }, 503);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: userData, error: userError } = await admin.auth.getUser(jwt);
  const user = userData.user;
  if (userError || !user) return json(request, { error: 'Sessão administrativa inválida.' }, 401);

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role,active')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError || !profile || profile.active !== true || profile.role !== 'nexus_admin') {
    return json(request, { error: 'Somente a administração Nexus pode iniciar homologação financeira.' }, 403);
  }

  // F01: enquanto homologação e produção compartilham o mesmo backend comercial,
  // não geramos checkouts de teste capazes de alimentar provisionamento real.
  // Reativar somente quando houver Supabase/destino CRM isolados para sandbox.
  return json(request, {
    error: 'Checkout CRM de homologação temporariamente bloqueado até existir ambiente financeiro isolado.',
    code: 'sandbox_isolation_required',
  }, 503);
});
