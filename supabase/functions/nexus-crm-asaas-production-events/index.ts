import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { trustedAsaasToken, sanitizeCrmAsaasEvent } from '../_shared/crm-asaas-events.mjs';

// Dedicated CRM Asaas PRODUCTION webhook inbox.
// HARD OFF until the isolated production settlement / provisioning worker is
// independently approved. Does not create charges, subscriptions or tenants.
// DO NOT point a live Asaas webhook here while hard-off (returns HTTP 503).
const STAGED_PRODUCTION_EVENTS_DISABLED = true;
const MAX_BODY_BYTES = 32768;

const respond = (body: unknown, status=200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff' },
});

async function readBoundedBody(req: Request): Promise<string|null> {
  const length = Number(req.headers.get('content-length') || '0');
  if (!Number.isFinite(length) || length > MAX_BODY_BYTES || !req.body) return null;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value?.length || 0;
      if (size > MAX_BODY_BYTES) return null;
      if (part.value) chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length; }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch { return null; } finally { try { await reader.cancel(); } catch { /* no-op */ } }
}

Deno.serve(async (request: Request): Promise<Response> => {
  // Provider settlement is not approved. Independent operator authorization
  // and reviewed migration are required before even receiving live events.
  if (STAGED_PRODUCTION_EVENTS_DISABLED) {
    return respond({ error:'Webhook mensal CRM Asaas de produção desativado.' },503);
  }
  if (Deno.env.get('NEXUS_CRM_ASAAS_PROD_EVENTS_ENABLED') !== 'true'
    || Deno.env.get('NEXUS_CRM_ASAAS_PROD_EVENTS_HOMOLOGATED') !== 'true') {
    return respond({ error:'Webhook mensal CRM Asaas não homologado.' },503);
  }

  if (request.method !== 'POST') return respond({error:'Método não permitido.'},405);
  const secret = Deno.env.get('NEXUS_CRM_ASAAS_PROD_EVENTS_TOKEN') || '';
  // Never use the API payment key as the webhook token.
  if (secret === (Deno.env.get('ASAAS_API_KEY') || '')
    || !trustedAsaasToken(request.headers.get('asaas-access-token'),secret)) {
    return respond({error:'Webhook não autorizado.'},401);
  }
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return respond({error:'Formato inválido.'},415);
  }
  const raw = await readBoundedBody(request);
  if (!raw) return respond({error:'Evento ausente ou grande demais.'},400);
  let incoming: unknown;
  try { incoming=JSON.parse(raw); } catch { return respond({error:'Evento inválido.'},400); }
  const sanitized=sanitizeCrmAsaasEvent(incoming);
  if (!sanitized) return respond({error:'Evento não reconhecido.'},422);

  const url=Deno.env.get('SUPABASE_URL') || '';
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || service.length < 30) return respond({error:'Inbox não configurada.'},503);
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const {error}=await admin.from('nexus_crm_asaas_production_events').insert({
    provider_event_id:sanitized.provider_event_id,
    event_type:sanitized.event_type,
    resource_id:sanitized.resource_id,
    payload:sanitized.payload,
    environment:'production',
  });
  if (error && error.code!=='23505') {
    // Retriable failure. Never acknowledge an event that was lost.
    return respond({error:'Falha temporária ao persistir evento.'},503);
  }
  // Ack before any reconciliation; idempotency by provider_event_id.
  return respond({received:true,duplicate:error?.code==='23505'},200);
});
