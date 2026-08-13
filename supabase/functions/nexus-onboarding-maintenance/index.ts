Deno.serve(() => new Response(
  JSON.stringify({ error: 'Maintenance endpoint disabled.' }),
  {
    status: 410,
    headers: { 'content-type': 'application/json' },
  },
));
