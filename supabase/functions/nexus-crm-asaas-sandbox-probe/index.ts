// TEMPORARY (2026-10-28): read-only Asaas Sandbox API credential probe.
// Does not create links, charges, subscriptions, customers, webhooks or accounts.
// Not used by any checkout. Expires automatically at 20:00 UTC, 28 Oct 2026.
const EXPIRES_AT = Date.parse('2026-10-28T20:00:00Z');
const CACHE_MS = 60_000;
const CHECK_URL = 'https://api-sandbox.asaas.com/v3/myAccount/status/';
let lastChecked = 0;
let cached = { code: 503, status: 'unavailable', reason: 'not_checked' };

const reply = (code: number, status: string, reason?: string) =>
  new Response(JSON.stringify({ status, ...(reason ? { reason } : {}), environment: 'sandbox', billing: 'disabled' }), {
    status: code,
    headers: { 'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store, max-age=0', 'x-content-type-options': 'nosniff' },
  });

Deno.serve(async (request: Request) => {
  if (request.method !== 'GET') return reply(405, 'unavailable', 'method');
  if (Date.now() >= EXPIRES_AT) return reply(410, 'expired');
  if (lastChecked && Date.now() - lastChecked < CACHE_MS) {
    return reply(cached.code, cached.status, cached.reason);
  }
  const key = Deno.env.get('ASAAS_SANDBOX_API_KEY') || '';
  if (key.length < 20) return reply(503, 'unavailable', 'key_missing');

  // Use only a documented read-only account-status endpoint; never reveal
  // the account data or the API key, even on errors.
  lastChecked = Date.now();
  try {
    const response = await fetch(CHECK_URL, {
      method: 'GET',
      headers: {
        'access_token': key,
        'User-Agent': 'NexusCRM-Sandbox-Probe/1.0',
        'Accept': 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(7_000),
    });
    try { await response.body?.cancel(); } catch { /* ignore */ }
    if (response.status === 200) {
      cached = { code: 200, status: 'authenticated', reason: '' };
    } else if (response.status === 401) {
      cached = { code: 503, status: 'unavailable', reason: 'key_rejected' };
    } else {
      cached = { code: 503, status: 'unavailable', reason: 'provider_unavailable' };
    }
  } catch {
    cached = { code: 503, status: 'unavailable', reason: 'network' };
  }
  return reply(cached.code, cached.status, cached.reason);
});
