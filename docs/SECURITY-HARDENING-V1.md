# Security hardening v1

## Controles incluídos

- Renderização de nomes de conta e organização somente com `textContent`/DOM seguro.
- Supabase JS e Chart.js fixados em versões exatas, com SRI e `crossorigin`.
- SheetJS fixado em versão exata e carregado com SRI.
- Dependências Supabase das Edge Functions fixadas em versão exata.
- CSP, HSTS e cabeçalhos defensivos no deploy Cloudflare.
- CORS restrito ao domínio configurado, previews Nexus e desenvolvimento local.
- Rate limit atômico por HMAC de endereço de origem; o endereço não é salvo no banco.
- Endpoint de status de venda reduzido ao estado mínimo necessário.
- Erros internos da Stripe deixam de ser devolvidos ao navegador.
- Boleto anual usa uma Payment Method Configuration dedicada da Stripe.
- Edge Function desativada de manutenção versionada para eliminar divergência entre produção e repositório.

## Ordem obrigatória de publicação

1. Aplicar `053_public_sales_rate_limit.sql`.
2. Criar na Stripe uma Payment Method Configuration de teste somente com boleto e outra equivalente em produção.
3. Configurar os segredos abaixo na Edge Function.
4. Publicar `nexus-public-sales`.
5. Publicar os assets Cloudflare.
6. Executar `npm run security:check`, `npm run build:cloudflare` e os testes manuais descritos abaixo.

Não publicar a nova Edge Function antes da migration: o rate limiter opera em modo fechado e responderá `503` se a função SQL não estiver disponível.

## Configuração necessária

- `NEXUS_PUBLIC_URL=https://nexuscore.app.br`
- `STRIPE_ANNUAL_PAYMENT_METHOD_CONFIGURATION_TEST=pmc_...`
- `STRIPE_ANNUAL_PAYMENT_METHOD_CONFIGURATION_LIVE=pmc_...`
- `STRIPE_SECRET_KEY`: usar chave restrita com o menor conjunto de permissões possível.
- `STRIPE_WEBHOOK_SECRET`: manter separado por ambiente.

Nunca registrar valores desses segredos em arquivos, logs ou mensagens de erro.

## Testes antes do go-live

- Login, restauração e troca de empresa com nomes contendo `<`, `>`, aspas e acentos.
- Importação de colaboradores, coletas e EPIs para confirmar o carregamento SRI do SheetJS.
- Dashboards para confirmar o carregamento SRI do Chart.js.
- Site comercial, Central Nexus e SST no desktop e no celular com a CSP aplicada.
- Limites de `lead`, `checkout` e `status`, incluindo resposta `429` após excesso.
- Checkout mensal em sandbox.
- Boleto anual em sandbox usando a configuração dedicada.
- Webhook duplicado e fora de ordem sem provisionamento duplicado.

## Riscos documentados

- A CSP ainda permite scripts e estilos inline porque o frontend atual concentra trechos legados dentro dos HTMLs. Ela já restringe origens, frames, objetos, formulários e conexões. A remoção de `unsafe-inline` exige extrair esses trechos para arquivos versionados e deve ocorrer em uma etapa própria para não quebrar o sistema inteiro de uma vez.
- As funções `SECURITY DEFINER` acessíveis a `authenticated` são RPCs necessárias ao modelo multiempresa, importações e documentos. `PUBLIC` e `anon` não possuem execução; as funções validam usuário, organização e papel internamente.
- A extensão `pg_net` está no schema `public`, mas a versão instalada não é relocável. Movê-la exige recriação da extensão e revisão de dependências; não deve ser feita como alteração automática de lançamento.
- A proteção de senhas vazadas depende do recurso disponível no plano Supabase. Enquanto indisponível, manter senha mínima, mensagens neutras de recuperação e autenticação forte nas contas administrativas.
