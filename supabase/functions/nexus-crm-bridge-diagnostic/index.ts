// CRM → Central HMAC connectivity diagnostic. No database, Stripe or customer access.
// Read-only and independent from the hard-disabled payment checkout.
import { verifyCheckoutBridgeSignature } from './signature.mjs';

const EXPECTED_ORIGIN = 'https://crm.nexuscore.app.br';
const EXPECTED_PURPOSE = 'nexus-crm-central-hmac-diagnostic-v1';

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function readLimitedBody(request: Request): Promise<string | null> {
  if (Number(request.headers.get('content-length') || '0') > 256) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > 256) return null;
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    try { reader.releaseLock(); } catch { /* no-op */ }
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) { result.set(c, offset); offset += c.byteLength; }
  try { return new TextDecoder('utf-8', { fatal: true }).decode(result); } catch { return null; }
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') return reply(405, { status: 'unavailable' });
  if (request.headers.get('origin') !== EXPECTED_ORIGIN) {
    return reply(403, { status: 'unavailable' });
  }
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return reply(415, { status: 'unavailable' });
  }

  // The diagnostic deliberately reuses the *production* HMAC secret but
  // cannot create a sale, verify an identity, or call the checkout service.
  const secret = Deno.env.get('NEXUS_CRM_CHECKOUT_BRIDGE_SECRET') || '';
  if (secret.length < 32) return reply(503, { status: 'unavailable' });

  const raw = await readLimitedBody(request);
  if (!raw) return reply(400, { status: 'unavailable' });
  const timestamp = request.headers.get('x-nexus-checkout-timestamp');
  const signature = request.headers.get('x-nexus-checkout-signature');
  if (!await verifyCheckoutBridgeSignature(raw, timestamp, signature, secret)) {
    return reply(403, { status: 'unavailable' });
  }

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return reply(400, { status: 'unavailable' }); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return reply(400, { status: 'unavailable' });
  }
  const data = body as Record<string, unknown>;
  if (Object.keys(data).length !== 2 || data.purpose !== EXPECTED_PURPOSE ||
      typeof data.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(data.nonce)) {
    return reply(400, { status: 'unavailable' });
  }

  // Fresh challenge echo, never a signature, key, payment reference or customer record.
  return reply(200, { status: 'connected', nonce: data.nonce });
});
