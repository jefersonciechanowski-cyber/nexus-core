import { createClient } from 'npm:@supabase/supabase-js@2.112.3';

/**
 * Nexus CRM public demo intake (not checkout and never provisions a tenant).
 * Deploy as verify_jwt=false ONLY after approval, with service-role credentials
 * stored server-side by Supabase. Intentionally separate from retired endpoints.
 */
const ORIGIN = 'https://crm.nexuscore.app.br';
const jsonHeaders = (origin: string) => ({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Vary': 'Origin',
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, x-client-info, apikey',
  'Access-Control-Max-Age': '600',
});

function allowedOrigins() {
  const extra = (Deno.env.get('NEXUS_CRM_INTAKE_ALLOWED_ORIGINS') || '').split(',')
    .map(value => value.trim()).filter(Boolean)
    .filter(value => {
      try {
        const url = new URL(value);
        return url.origin === value && url.protocol === 'https:' && !url.username && !url.password;
      } catch { return false; }
    });
  return new Set([ORIGIN, ...extra]);
}
function answer(body: unknown, status: number, origin: string) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders(origin) });
}
function clean(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}
function digits(value: unknown) {
  return clean(value, 40).replace(/\D/g, '');
}
function emailValid(value: string) {
  return value.length <= 180 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
async function hmacHex(secret: string, input: string) {
  const bytes = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', bytes.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes.encode(input)));
  return Array.from(signed, item => item.toString(16).padStart(2, '0')).join('');
}
async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > 16_384) return null;
      chunks.push(value);
    }
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
    const data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(merged));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
  } catch { return null; }
  finally { try { reader.releaseLock(); } catch { /* no-op */ } }
}

Deno.serve(async request => {
  const origin = request.headers.get('Origin') || '';
  // A browser-origin check is not authentication; rate limit and honeypot also apply.
  if (!allowedOrigins().has(origin)) return answer({ error: 'Origem não autorizada.' }, 403, ORIGIN);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: jsonHeaders(origin) });
  if (request.method !== 'POST') return answer({ error: 'Método não permitido.' }, 405, origin);
  if (Deno.env.get('NEXUS_CRM_DEMO_INTAKE_ENABLED') !== 'true') {
    return answer({ error: 'As demonstrações ainda não estão disponíveis.' }, 503, origin);
  }
  if (!String(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return answer({ error: 'Conteúdo não suportado.' }, 415, origin);
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return answer({ error: 'Serviço temporariamente indisponível.' }, 503, origin);

  const body = await readJson(request);
  if (!body) return answer({ error: 'Dados inválidos ou tamanho excedido.' }, 400, origin);
  // Never persist honeypot contents and do not reveal that bot protection fired.
  if (clean(body.website, 200)) return answer({ ok: true }, 200, origin);

  const companyName = clean(body.companyName, 140);
  const responsibleName = clean(body.responsibleName, 140);
  const email = clean(body.email, 180).toLowerCase();
  const phone = digits(body.phone).slice(0, 15);
  const teamSize = Number(body.teamSize);
  const planCode = clean(body.planCode, 40).toLowerCase();
  const allowedPlanCodes = new Set(['', 'start', 'pro', 'gestao']);

  if (companyName.length < 2 || responsibleName.length < 2 || !emailValid(email)
      || phone.length < 10 || !allowedPlanCodes.has(planCode)
      || (body.teamSize !== undefined && body.teamSize !== '' && (!Number.isSafeInteger(teamSize) || teamSize < 1 || teamSize > 10_000))) {
    return answer({ error: 'Confira os dados da empresa, contato e plano.' }, 400, origin);
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const ip = clean(request.headers.get('cf-connecting-ip'), 80)
    || clean(request.headers.get('x-real-ip'), 80)
    || clean(request.headers.get('x-forwarded-for'), 200).split(',')[0].trim() || 'unknown';
  try {
    const fingerprint = await hmacHex(serviceKey, 'crm-demo-v1:' + ip);
    const { data: accepted, error: limitError } = await admin.rpc('consume_nexus_public_request_limit', {
      p_fingerprint_hash: fingerprint,
      p_action: 'crm-demo-lead',
      p_window_seconds: 3600,
      p_limit: 5,
    });
    if (limitError) throw limitError;
    if (accepted !== true) return answer({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, 429, origin);
  } catch (error) {
    console.error('CRM demo intake rate-limit unavailable:', error instanceof Error ? error.message : 'unknown');
    return answer({ error: 'Serviço temporariamente indisponível.' }, 503, origin);
  }

  const { data: product, error: productError } = await admin.from('nexus_products')
    .select('id').eq('code', 'crm').eq('status', 'active').maybeSingle();
  if (productError || !product) return answer({ error: 'Serviço temporariamente indisponível.' }, 503, origin);

  let planId: string | null = null;
  if (planCode) {
    const { data: plan, error: planError } = await admin.from('nexus_plans')
      .select('id').eq('product_id', product.id).eq('code', planCode).eq('status', 'active').maybeSingle();
    if (planError || !plan?.id) return answer({ error: 'Plano indisponível.' }, 409, origin);
    planId = plan.id;
  }

  // Limit duplicates without exposing whether a specific e-mail already exists.
  const recent = new Date(Date.now() - 15 * 60_000).toISOString();
  const { count, error: duplicateError } = await admin.from('nexus_sales')
    .select('id', { count: 'exact', head: true })
    .eq('product_id', product.id).eq('source', 'site-captacao').eq('sale_status', 'lead')
    .eq('email', email).gte('created_at', recent);
  if (duplicateError) return answer({ error: 'Serviço temporariamente indisponível.' }, 503, origin);
  if (count && count > 0) return answer({ ok: true }, 200, origin);

  // Team size is CRM seats, NOT employee_count (the latter is SST-specific).
  const attributions: Array<[string, string]> = [
    ['Interesse', 'Demonstração Nexus CRM'],
    ['Equipe (usuários)', Number.isInteger(teamSize) && teamSize > 0 ? String(teamSize) : 'Não informado'],
    ['Origem UTM', clean(body.utmSource, 100)],
    ['Mídia UTM', clean(body.utmMedium, 100)],
    ['Conteúdo UTM', clean(body.utmContent, 100)],
    ['Termo UTM', clean(body.utmTerm, 100)],
    ['Página de referência', clean(body.referrer, 300)],
  ];
  const leadNotes = attributions.filter(([, value]) => value).map(([key, value]) => key + ': ' + value).join('\n').slice(0, 1800);
  const campaign = clean(body.utmCampaign, 160);
  const { error: insertError } = await admin.from('nexus_sales').insert({
    product_id: product.id,
    plan_id: planId,
    sale_status: 'lead',
    lead_stage: 'new',
    source: 'site-captacao',
    company_name: companyName,
    responsible_name: responsibleName,
    email,
    phone,
    employee_count: null,
    campaign_name: campaign || null,
    lead_notes: leadNotes || null,
    provider: 'stripe', // required legacy column; not a payment or checkout
    environment: 'production',
    billing_mode: 'recurring',
    billing_cycle_months: 1,
  });
  if (insertError) {
    console.error('CRM demo intake insert failed:', insertError.code || 'unknown');
    return answer({ error: 'Não foi possível registrar a solicitação.' }, 503, origin);
  }

  return answer({ ok: true }, 200, origin);
});
