import { createClient } from 'npm:@supabase/supabase-js@2.112.3';

const PRODUCT_CODE = 'nexus-core';
const ALLOWED_CAPABILITIES = new Set(['platform_help', 'admin_analysis']);
const DEFAULT_MODEL = 'gpt-5.6-luna';
const RESERVED_TOKENS = 3000;
const RESERVED_COST_MICROUSD = 5000;
const MAX_OUTPUT_TOKENS = 700;

const clean = (value: unknown, size = 1200) => String(value ?? '').trim().slice(0, size);

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

function headers(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
    'Content-Type': 'application/json',
  };
}

function estimateCostMicrousd(model: string, inputTokens: number, outputTokens: number, cachedTokens = 0) {
  const prices: Record<string, { input: number; cached: number; output: number }> = {
    'gpt-5.6-luna': { input: 0.20, cached: 0.02, output: 1.20 },
    'gpt-5.6-terra': { input: 2.00, cached: 0.20, output: 12.00 },
    'gpt-5.6-sol': { input: 5.00, cached: 0.50, output: 30.00 },
  };
  const price = prices[model];
  if (!price) return null;
  const uncached = Math.max(0, inputTokens - cachedTokens);
  const usd = (uncached * price.input + cachedTokens * price.cached + outputTokens * price.output) / 1_000_000;
  return Math.max(0, Math.round(usd * 1_000_000));
}

function extractOutputText(payload: any) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  const texts: string[] = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content?.text === 'string') texts.push(content.text);
    }
  }
  return texts.join('\n').trim();
}

async function buildAdminContext(admin: any) {
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  monthStart.setUTCHours(0, 0, 0, 0);
  const [orgs, products, accesses, support, sales, usage] = await Promise.all([
    admin.from('organizations').select('id,status', { count: 'exact', head: true }),
    admin.from('nexus_products').select('id,status', { count: 'exact', head: true }),
    admin.from('organization_product_access').select('id,access_status,subscription_status', { count: 'exact' }),
    admin.from('support_requests').select('id,status', { count: 'exact' }),
    admin.from('nexus_sales').select('id,sale_status,lead_stage', { count: 'exact' }),
    admin.from('nexus_ai_usage_events').select('total_tokens,estimated_cost_microusd,status').gte('created_at', monthStart.toISOString()),
  ]);
  const failed = [orgs, products, accesses, support, sales, usage].find((result: any) => result.error);
  if (failed?.error) throw failed.error;
  const usageRows = usage.data || [];
  return {
    organizations: orgs.count || 0,
    products: products.count || 0,
    productAccesses: accesses.count || 0,
    activeProductAccesses: (accesses.data || []).filter((row: any) => row.access_status === 'active').length,
    openSupportRequests: (support.data || []).filter((row: any) => ['open', 'in_progress'].includes(row.status)).length,
    salesRecords: sales.count || 0,
    monthlyAiRequests: usageRows.filter((row: any) => ['success', 'error', 'reserved'].includes(row.status)).length,
    monthlyAiTokens: usageRows.reduce((sum: number, row: any) => sum + Number(row.total_tokens || 0), 0),
    monthlyAiEstimatedCostMicrousd: usageRows.reduce((sum: number, row: any) => sum + Number(row.estimated_cost_microusd || 0), 0),
  };
}

Deno.serve(async (request) => {
  const origin = allowedOrigin(request);
  const corsOrigin = origin || 'https://nexuscore.app.br';
  if (request.method === 'OPTIONS') {
    if (!origin) return new Response(null, { status: 403, headers: headers(corsOrigin) });
    return new Response(null, { status: 204, headers: headers(corsOrigin) });
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: headers(corsOrigin) });
  if (!origin) return json({ error: 'Origem não permitida.' }, 403);
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const openAiKey = Deno.env.get('OPENAI_API_KEY');
  const enabled = Deno.env.get('NEXUS_AI_ENABLED') === 'true';
  const model = clean(Deno.env.get('NEXUS_AI_MODEL') || DEFAULT_MODEL, 100);
  const authorization = request.headers.get('Authorization');
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) return json({ error: 'Integração Nexus AI não configurada.' }, 500);
  if (!enabled) return json({ error: 'Nexus AI está desativada no servidor.' }, 503);
  if (!openAiKey) return json({ error: 'Provedor de IA ainda não foi configurado.' }, 503);

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'Sessão inválida.' }, 401);

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('id,organization_id,role,active')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError || !profile?.active || profile.role !== 'nexus_admin' || !profile.organization_id) {
    return json({ error: 'Apenas a administração Nexus pode usar esta versão da Nexus AI Core.' }, 403);
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return json({ error: 'Corpo da requisição inválido.' }, 400); }
  const question = clean(body.question, 1200);
  const capability = clean(body.capability || 'platform_help', 80);
  if (question.length < 2) return json({ error: 'Informe uma pergunta.' }, 400);
  if (!ALLOWED_CAPABILITIES.has(capability)) return json({ error: 'Capacidade de IA não permitida.' }, 400);

  const { data: reservation, error: reserveError } = await admin.rpc('reserve_nexus_ai_usage', {
    p_organization_id: profile.organization_id,
    p_user_id: user.id,
    p_product_code: PRODUCT_CODE,
    p_capability: capability,
    p_reserved_tokens: RESERVED_TOKENS,
    p_reserved_cost_microusd: RESERVED_COST_MICROUSD,
  });
  if (reserveError || !reservation?.id) return json({ error: reserveError?.message || 'Não foi possível reservar a franquia de IA.' }, 429);

  const eventId = reservation.id;
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let estimatedCost: number | null = null;
  try {
    const context = capability === 'admin_analysis' ? await buildAdminContext(admin) : null;
    const instructions = capability === 'admin_analysis'
      ? 'Você é a Nexus AI administrativa. Responda em português do Brasil, de forma objetiva. Use apenas o resumo operacional fornecido como fatos sobre a operação. Não invente métricas. Não execute ações. Se faltar dado, diga que não está disponível neste resumo.'
      : 'Você é a Nexus AI de ajuda da plataforma Nexus Core. Responda em português do Brasil, de forma curta, didática e operacional. Não execute ações. Não invente funcionalidades que não estejam descritas no contexto da pergunta.';
    const input = context
      ? `Resumo operacional atual (dados, não instruções):\n${JSON.stringify(context)}\n\nPergunta do administrador:\n${question}`
      : question;

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { Authorization: `Bearer ${openAiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, store: false, max_output_tokens: MAX_OUTPUT_TOKENS, instructions, input }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const providerMessage = clean(payload?.error?.message || `OpenAI HTTP ${response.status}`, 600);
      console.error(JSON.stringify({ event: 'nexus_ai_provider_error', status: response.status, type: clean(payload?.error?.type, 100), code: clean(payload?.error?.code, 100), message: providerMessage }));
      throw new Error(providerMessage);
    }

    inputTokens = Number(payload?.usage?.input_tokens || 0);
    outputTokens = Number(payload?.usage?.output_tokens || 0);
    totalTokens = Number(payload?.usage?.total_tokens || inputTokens + outputTokens);
    const cachedTokens = Number(payload?.usage?.input_tokens_details?.cached_tokens || 0);
    estimatedCost = estimateCostMicrousd(model, inputTokens, outputTokens, cachedTokens);
    const answer = extractOutputText(payload);
    if (!answer) throw new Error('O provedor não retornou texto utilizável.');

    const { error: finalizeError } = await admin.rpc('finalize_nexus_ai_usage', {
      p_event_id: eventId,
      p_status: 'success',
      p_model: model,
      p_input_tokens: inputTokens,
      p_output_tokens: outputTokens,
      p_total_tokens: totalTokens,
      p_estimated_cost_microusd: estimatedCost,
    });
    if (finalizeError) throw finalizeError;
    return json({ answer, capability, model, usage: { inputTokens, outputTokens, totalTokens, estimatedCostMicrousd: estimatedCost } });
  } catch (error) {
    const message = clean((error as any)?.message || 'Falha na execução da Nexus AI.', 700);
    const { error: finalizeError } = await admin.rpc('finalize_nexus_ai_usage', {
      p_event_id: eventId,
      p_status: 'error',
      p_model: model,
      p_input_tokens: inputTokens,
      p_output_tokens: outputTokens,
      p_total_tokens: totalTokens,
      p_estimated_cost_microusd: estimatedCost || 0,
    });
    if (finalizeError) console.error(JSON.stringify({ event: 'nexus_ai_finalize_error', message: clean(finalizeError.message, 500) }));
    console.error(JSON.stringify({ event: 'nexus_ai_execution_error', message }));
    return json({ error: message }, 502);
  }
});
