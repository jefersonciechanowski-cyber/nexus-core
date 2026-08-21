Deno.serve(() => new Response(JSON.stringify({
  error: 'Endpoint indisponível.',
}), {
  status: 410,
  headers: { 'Content-Type': 'application/json' },
}));
