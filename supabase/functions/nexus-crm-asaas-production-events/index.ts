import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { trustedAsaasToken, sanitizeCrmAsaasEvent } from '../_shared/crm-asaas-events.mjs';

// Dedicated CRM Asaas PRODUCTION webhook inbox, receive-only.
// Storage has independent explicit opt-in and stays OFF by default.
// Worker, checkout, renewals and entitlements remain HARD OFF separately.
// This endpoint ONLY authenticates, minimizes and persists events; it never
// settles funds or grants CRM access.
const RECEIVE_ONLY_MODE = true;
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
  // Explicit configuration is required BEFORE accepting any provider event.
  // Setting these flags enables ONLY authenticated event storage.
  // Neither flag authorizes payment settlement, onboarding or renewal.
  if (!RECEIVE_ONLY_MODE
    || Deno.env.get('NEXUS_CRM_ASAAS_PROD_EVENTS_ENABLED') !== 'true'
    || Deno.env.get('NEXUS_CRM_ASAAS_PROD_EVENTS_RECEIVE_ONLY_ENABLED') !== 'true') {
    return respond({ error:'Recebimento de webhook CRM produção desativado.' },503);
  }

  if (request.method !== 'POST') return respond({error:'Método não permitido.'},405);
  const secret = Deno.env.get('NEXUS_CRM_ASAAS_PROD_EVENTS_TOKEN') || '';
  // A provider webhook token must be 32-255 chars, random, and distinct
  // from BOTH API environments and all Nexus finance worker credentials.
  const unsafeToken = secret.length < 32 || secret.length > 255
    || /\s/.test(secret)
    || [
      'ASAAS_API_KEY', 'ASAAS_PRODUCTION_API_KEY', 'ASAAS_SANDBOX_API_KEY',
      'NEXUS_CRM_ASAAS_PROD_WORKER_SECRET',
      'NEXUS_CRM_ASAAS_PROD_VERIFY_SECRET',
      'NEXUS_CRM_ASAAS_PROD_RENEWAL_SECRET',
      'NEXUS_CRM_ASAAS_PROD_CHECKOUT_BRIDGE_SECRET',
    ].some(name => {
      const other = Deno.env.get(name);
      return !!other && other === secret;
    });
  if (unsafeToken
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
