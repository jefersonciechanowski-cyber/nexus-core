Deno.serve(() => new Response(
  JSON.stringify({
    error: 'Endpoint legado desativado. Use o fluxo comercial oficial do Nexus.',
  }),
  {
    status: 410,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  },
));
