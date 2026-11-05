// Retired after the one-time GitHub OIDC verification on 05 Nov 2026.
// Original Asaas verification secret and other functions remain unchanged.
// The provider returned manual_review/customer_document_mismatch.
Deno.serve(() => new Response(JSON.stringify({
  decision: 'hold',
  reason: 'one_time_diagnostic_retired',
}), {
  status: 410,
  headers: {'content-type':'application/json; charset=utf-8','cache-control':'no-store'},
}));
