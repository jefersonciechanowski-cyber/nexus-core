Deno.serve(() => new Response(
  JSON.stringify({
    error: 'Endpoint legado desativado. O provisionamento oficial ocorre diretamente no Nexus CRM.',
  }),
  {
    status: 410,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  },
));
