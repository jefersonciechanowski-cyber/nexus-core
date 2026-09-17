import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import Stripe from 'npm:stripe@22.1.1';

const MAX_BODY_BYTES = 256 * 1024;
const clean = (value: unknown, size = 500) => String(value ?? '').trim().slice(0, size);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

Deno.serve(async request => {
  if (request.method !== 'POST') return json({ error: 'Método não permitido.' }, 405);

  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) return json({ error: 'Payload muito grande.' }, 413);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY_TEST');
  const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET_TEST');
  if (!supabaseUrl || !serviceRoleKey || !stripeSecretKey || !webhookSecret) {
    return json({ error: 'Webhook Stripe de homologação não configurado.' }, 503);
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) return json({ error: 'Assinatura Stripe ausente.' }, 400);

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) return json({ error: 'Payload muito grande.' }, 413);

  const stripe = new Stripe(stripeSecretKey, { httpClient: Stripe.createFetchHttpClient() });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      webhookSecret,
      undefined,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return json({ error: 'Assinatura Stripe inválida.' }, 400);
  }

  if (event.livemode) {
    return json({ error: 'Evento live recusado pelo webhook de homologação.' }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const eventId = clean(event.id, 255);
  const eventType = clean(event.type, 120);
  const resource: any = event.data?.object || {};
  const resourceId = clean(resource?.id, 255) || null;

  // F01: eventos Stripe TEST ficam registrados para auditoria, mas nunca alteram
  // contratos comerciais nem chamam o provisionamento do CRM compartilhado.
  const { data: previous, error: previousError } = await admin
    .from('nexus_payment_webhook_events')
    .select('processed_at')
    .eq('provider_event_id', eventId)
    .maybeSingle();
  if (previousError) return json({ error: 'Não foi possível verificar o evento de homologação.' }, 500);
  if (previous?.processed_at) return json({ ok: true, duplicate: true, sandbox: true, provisioned: false });

  const now = new Date().toISOString();
  const { error: upsertError } = await admin.from('nexus_payment_webhook_events').upsert({
    provider_event_id: eventId,
    provider: 'stripe',
    event_type: `sandbox.${eventType}`,
    resource_id: resourceId,
    payload: event as any,
    processed_at: now,
    error_message: 'Sandbox event intentionally isolated from commercial provisioning.',
  }, { onConflict: 'provider_event_id' });

  if (upsertError) {
    console.error('crm_test_webhook_audit_failed', { event_id: eventId, error: clean(upsertError.message, 400) });
    return json({ error: 'Não foi possível registrar o evento de homologação.' }, 500);
  }

  return json({
    ok: true,
    sandbox: true,
    provisioned: false,
    event_id: eventId,
    event_type: eventType,
  });
});
