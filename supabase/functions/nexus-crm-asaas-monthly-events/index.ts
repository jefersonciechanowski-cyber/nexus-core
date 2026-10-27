import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { trustedAsaasToken, sanitizeCrmAsaasEvent } from '../_shared/crm-asaas-events.mjs';

// Staging-only webhook inbox. No entitlements, emails, payments or agency
// courtesies are modified here. Settlement is a separate, reviewed milestone.
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method !== 'POST') return response({ error: 'Método não permitido.' }, 405);
  if (Deno.env.get('NEXUS_CRM_ASAAS_EVENTS_ENABLED') !== 'true'
      || Deno.env.get('NEXUS_CRM_ASAAS_MONTHLY_MODE') !== 'sandbox') {
    return response({ error: 'Webhook CRM Asaas não habilitado.' }, 503);
  }
  const expectedToken = Deno.env.get('NEXUS_CRM_ASAAS_EVENTS_TEST_TOKEN') || '';
  if (!trustedAsaasToken(request.headers.get('asaas-access-token'), expectedToken)) {
    return response({ error: 'Webhook não autorizado.' }, 401);
  }
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return response({ error: 'Formato inválido.' }, 415);
  }
  const sizeHeader = Number(request.headers.get('content-length') || '0');
  if (Number.isFinite(sizeHeader) && sizeHeader > 32768) return response({ error: 'Evento muito grande.' }, 413);
  let raw: string;
  try {
    const reader = request.body?.getReader();
    if (!reader) return response({ error: 'Evento ausente.' }, 400);
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value?.length || 0;
      if (size > 32768) return response({ error: 'Evento muito grande.' }, 413);
      if (part.value) chunks.push(part.value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return response({ error: 'Evento inválido.' }, 400);
  }

  let decoded: unknown;
  try { decoded = JSON.parse(raw); } catch { return response({ error: 'Evento inválido.' }, 400); }
  const event = sanitizeCrmAsaasEvent(decoded);
  if (!event) return response({ error: 'Evento de pagamento não reconhecido.' }, 422);

  const url = Deno.env.get('SUPABASE_URL') || '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!url || !key) return response({ error: 'Serviço indisponível.' }, 503);
  const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await admin.from('nexus_payment_webhook_events').insert(event);
  if (error && error.code !== '23505') {
    // Return 503 so Asaas retries. Do not acknowledge loss of an event.
    console.error('crm-asaas-event-save-failed', String(error.code || 'unknown').slice(0, 30));
    return response({ error: 'Não foi possível guardar o evento.' }, 503);
  }

  // At-least-once deliveries: duplicates receive 200, without repeated side effects.
  // The persisted event will be reconciled with link, amount, method and plan
  // before CRM access is granted by a separately-reviewed worker.
  return response({ received: true, duplicate: error?.code === '23505' });
});
