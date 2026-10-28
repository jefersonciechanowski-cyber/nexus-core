// Retired after successful Asaas Sandbox authentication, 28 Oct 2026.
// The probe does not read API keys and does not connect to Asaas.
Deno.serve((_request: Request) => new Response(
  JSON.stringify({ status: 'retired', billing: 'disabled' }),
  { status: 410, headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store, max-age=0',
    'x-content-type-options': 'nosniff',
  } },
));
