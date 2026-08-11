Deno.serve(() => new Response(JSON.stringify({
  error: 'Integração Asaas desativada. A cobrança Nexus utiliza Stripe.',
}), {
  status: 410,
  headers: { 'Content-Type': 'application/json' },
}));
