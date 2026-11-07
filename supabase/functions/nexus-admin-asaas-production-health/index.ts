import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { assessCrmAsaasProductionWebhook } from '../_shared/crm-asaas-webhook-readiness.mjs';

// Read-only authorization diagnostic. No customer, payment, subscription,
// withdrawal, key material or personally identifiable data can be returned.
// This endpoint intentionally cannot create a financial transaction.
const ALLOWED_ORIGINS = new Set([
  'https://nexuscore.app.br',
  'https://www.nexuscore.app.br',
  'https://central.nexuscore.app.br',
]);
const ASAAS_BASE = 'https://api.asaas.com/v3';
const PATHS = [
  '/myAccount/status/',
  '/customers?limit=1',
  '/payments?limit=1',
] as const;

function response(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'vary': 'Origin',
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'authorization, apikey, x-client-info, content-type',
    },
  });
}

function classify(status: number) {
  if (status === 200) return 'ok';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'permission_or_ip_restricted';
  if (status === 429) return 'rate_limited';
  return 'unavailable';
}

function approval(value: unknown) {
  return value === 'APPROVED' || value === 'PENDING'
    || value === 'AWAITING_APPROVAL' || value === 'REJECTED' ? value : 'UNKNOWN';
}

async function readWebhooks(key: string, centralUrl: string) {
  // GET only. Never return the provider response: it might contain tokens,
  // other products' webhook URLs or contact email addresses.
  const result = await fetch(ASAAS_BASE + '/webhooks?limit=100', {
    method: 'GET',
    headers: { access_token:key, accept:'application/json',
      'User-Agent':'NexusCRM-Webhook-ReadOnly-Diagnostic/1.0' },
    signal: AbortSignal.timeout(7500),
  });
  if (result.status !== 200) return {status:classify(result.status),
    receiverBlocked:true, createdCharge:false, production:true};
  if(Number(result.headers.get('content-length')||0)>64000)
    return {status:'provider_response_invalid',receiverBlocked:true,
      createdCharge:false,production:true};
  const raw=await result.text();
  if(raw.length>64000)return {status:'provider_response_invalid',receiverBlocked:true,
    createdCharge:false,production:true};
  let payload:unknown;
  try{payload=JSON.parse(raw);}catch{payload=null;}
  const entries=(payload && typeof payload==='object')
    ?(payload as Record<string,unknown>).data:null;
  const expected=new URL('/functions/v1/nexus-crm-asaas-production-events',centralUrl).toString();
  const configuredToken=Deno.env.get('NEXUS_CRM_ASAAS_PROD_EVENTS_TOKEN')||'';
  const secretOk=configuredToken.length>=32 && configuredToken.length<=255
    && configuredToken!==(Deno.env.get('ASAAS_PRODUCTION_API_KEY')||'')
    && configuredToken!==(Deno.env.get('NEXUS_CRM_ASAAS_PROD_WORKER_SECRET')||'')
    && configuredToken!==(Deno.env.get('NEXUS_CRM_ASAAS_PROD_VERIFY_SECRET')||'');
  const assessment=assessCrmAsaasProductionWebhook(entries,expected,secretOk);
  return {...assessment,receiverBlocked:true,createdCharge:false,production:true,
    // The endpoint URL is not a secret; it is necessary for the provider setup.
    receiverUrl:expected,
    // Inspecting webhook GET does not verify token matching or actual delivery.
    tokenVerifiedByDelivery:false};
}

async function checkAsaas(key: string, path: typeof PATHS[number]) {
  const result = await fetch(ASAAS_BASE + path, {
    method: 'GET',
    headers: {
      access_token: key,
      accept: 'application/json',
      'User-Agent': 'NexusCore-CRM-ReadOnly-Check/1.0',
    },
    signal: AbortSignal.timeout(7500),
  });
  if (result.status !== 200) {
    // Never return or log provider error bodies, tokens, customers or payments.
    return { status: classify(result.status), general: 'UNKNOWN' };
  }
  if (path !== PATHS[0]) {
    // No response body parsed or sent for customer/payment queries.
    try { await result.body?.cancel(); } catch { /* ignored */ }
    return { status: 'ok', general: 'UNKNOWN' };
  }
  const text = await result.text();
  if (text.length > 12000) return { status: 'unavailable', general: 'UNKNOWN' };
  try {
    const record = JSON.parse(text) as Record<string, unknown>;
    return { status: 'ok', general: approval(record?.general) };
  } catch {
    return { status: 'unavailable', general: 'UNKNOWN' };
  }
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin') || '';
  const cors = ALLOWED_ORIGINS.has(origin) ? origin : 'https://nexuscore.app.br';
  if (!ALLOWED_ORIGINS.has(origin)) return response({ error: 'Origem não autorizada.' }, 403, cors);
  if (request.method === 'OPTIONS') return new Response(null, {
    status: 204, headers: response({}, 200, cors).headers,
  });
  if (request.method !== 'POST') return response({ error: 'Método não permitido.' }, 405, cors);
  const type = request.headers.get('content-type') || '';
  if (!type.toLowerCase().startsWith('application/json')) {
    return response({ error: 'Solicitação inválida.' }, 400, cors);
  }
  const length = Number(request.headers.get('content-length') || 0);
  if (!Number.isFinite(length) || length > 512) {
    return response({ error: 'Solicitação inválida.' }, 400, cors);
  }
  let action: string | null = null;
  try {
    const data: unknown = await request.json();
    if(data && typeof data==='object' && !Array.isArray(data)
      && Object.keys(data).length===1
      && ['check','webhooks'].includes(String((data as Record<string,unknown>).action))) {
      action=String((data as Record<string,unknown>).action);
    }
  } catch { /* rejected */ }
  if (action !== 'check') return response({ error: 'Solicitação inválida.' }, 400, cors);

  const url = Deno.env.get('SUPABASE_URL') || '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') || '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const authHeader = request.headers.get('Authorization') || '';
  if (!url || !anon || !service || !/^Bearer\s+\S+$/i.test(authHeader)) {
    return response({ error: 'Sessão administrativa indisponível.' }, 401, cors);
  }
  const userClient = createClient(url, anon, { global: { headers: {
    Authorization: authHeader,
  } } });
  const admin = createClient(url, service, { auth: {
    persistSession: false, autoRefreshToken: false,
  } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return response({ error: 'Sessão inválida.' }, 401, cors);
  const accessToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  const { data: level, error: levelError } =
    await userClient.auth.mfa.getAuthenticatorAssuranceLevel(accessToken);
  if (levelError || level?.currentLevel !== 'aal2') {
    return response({ error: 'Confirme MFA2 na Nexus Central.' }, 403, cors);
  }
  const { data: profile, error: profileError } = await admin.from('profiles')
    .select('role,active').eq('id', user.id).maybeSingle();
  if (profileError || profile?.role !== 'nexus_admin' || profile.active !== true) {
    return response({ error: 'Somente administrador Nexus autorizado.' }, 403, cors);
  }

  const key = Deno.env.get('ASAAS_PRODUCTION_API_KEY') || '';
  if (!key.startsWith('$aact_prod_') || key.length < 32 || key.length > 2000) {
    return response(action==='webhooks'
      ? {status:'missing_or_wrong_environment',receiverBlocked:true,
        production:true,createdCharge:false}
      : {connection:'missing_or_wrong_environment',
        production:true,createdCharge:false}, 200, cors);
  }
  if(action==='webhooks') {
    try { return response(await readWebhooks(key,url),200,cors); }
    catch { return response({status:'unavailable',receiverBlocked:true,
      createdCharge:false,production:true},200,cors); }
  }
  const results = [] as { status: string; general: string }[];
  for (const path of PATHS) {
    try {
      const status = await checkAsaas(key, path);
      results.push(status);
      if (status.status === 'unauthorized' || status.status === 'rate_limited') break;
    } catch {
      results.push({ status: 'unavailable', general: 'UNKNOWN' });
      break;
    }
  }
  return response({
    connection: results[0]?.status || 'unavailable',
    accountApproval: results[0]?.general || 'UNKNOWN',
    customersRead: results[1]?.status === 'ok',
    paymentsRead: results[2]?.status === 'ok',
    production: true,
    createdCharge: false,
  }, 200, cors);
});
