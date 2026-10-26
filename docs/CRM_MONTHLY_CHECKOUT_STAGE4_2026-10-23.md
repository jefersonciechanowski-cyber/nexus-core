# Etapa 4 — Pagamento mensal público Nexus CRM (cartão)

**Estado: código apenas em branch, sem deploy.** Revisão 23/10/2026. Controle [Nexus CRM #80](https://github.com/nexuscoreindustria-create/nexus-crm/issues/80).

## Regra comercial definitiva

Há **dois caminhos independentes**, que NÃO devem ser confundidos:

1. **Cortesia da Nexus Central / pacote da agência:** o responsável interno pode liberar o CRM sem cobrança adicional como parte de um contrato de serviços. Manter todos os recursos e períodos de cortesia existentes, incluindo cortesias por meses. **Não converter cortesia em assinatura nem encurtar acessos**.
2. **Contratação diretamente em crm.nexuscore.app.br:** cliente escolhe Start R$79/mês, Pro R$119/mês ou Gestão R$159/mês, cobrança renovada mensalmente, sem compra integral de 10/12 meses. Aceite explícito dos termos e início da cobrança. A Central controla o cadastro e os direitos de acesso a partir de webhooks assinados.
3. **Teste promocional de 15/30 dias:** implementar em etapa 5 com controles administrativos e elegibilidade próprios. **Não transformar a cortesia antiga em teste automático de site** nem iniciar cobrança ao fim do período sem autorização.

### Provedor de pagamento

- Cartão de crédito: **Stripe Checkout Hosted**, `mode=subscription`, `interval=month`, `interval_count=1`, `payment_method_configuration` com configuração Stripe **restrita a cartão** verificada no dashboard.
- **Pix/boleto mensal:** requer implementação separada Asaas, com boleto/fatura por mês e pagamento manual do cliente (ou modalidade automática expressamente autorizada). O Stripe brasileiro **não oferece Pix recorrente automático neste fluxo**. Não exibir Pix/boleto como disponíveis até homologação real.
- **Não há parcela de 12 meses nem fidelidade anual:** os preços e periodicidades são carregados do catálogo `nexus_plans`, nunca enviados pelo usuário.

## Código novo — somente branch de desenvolvimento

Central: `supabase/functions/nexus-public-crm-monthly-checkout/index.ts` + `contract.mjs`.
CRM: `app/api/public/crm-checkout/route.ts` com ponte autenticada servidor-servidor; `CheckoutLauncher.tsx` informa mensalidade e métodos disponíveis.

**Endpoint novo** `nexus-public-crm-monthly-checkout`. **Não reativar** `nexus-public-crm-sales`, `asaas-create-checkout` ou `asaas-webhook`, que permanecem 410.

### Travamentos e segredos

- Secret compartilhado >=32 caracteres `NEXUS_CRM_CHECKOUT_BRIDGE_SECRET` deve existir no ambiente servidor Next.js **e** no Supabase Central. Next envia HMAC-SHA256 sobre timestamp + corpo JSON; Edge verifica assinatura e tolerância de 5 minutos. **Nunca disponibilizar esse segredo no client-side**.
- `NEXUS_CRM_MONTHLY_CHECKOUT_ENABLED=true` na Central, ausente/desativado por padrão.
- Definir `NEXUS_CRM_CARD_PAYMENT_CONFIG_TEST=pmc_...` e `NEXUS_CRM_CARD_PAYMENT_CONFIG_LIVE=pmc_...` para as configurações de meios de pagamento da Stripe **verificadas como somente cartão** em cada ambiente. Se não configurado, o serviço não abre checkout. Não utilizar a mesma configuração nas contas de teste e produção.
- **Somente sandbox:** `NEXUS_CRM_MONTHLY_CHECKOUT_MODE=sandbox`, `STRIPE_TEST_SECRET_KEY=sk_test_...`. Com planos `public_visible=false`, somente permitir teste autorizado com `NEXUS_CRM_CHECKOUT_TEST_ALLOW_HIDDEN_PLANS=true` em sandbox; manter flag falsa no live.
- **Live exige TRÊS condições** `NEXUS_CRM_MONTHLY_CHECKOUT_ENABLED=true`, `NEXUS_CRM_LIVE_CHECKOUT_ENABLED=true`, `NEXUS_PAYMENT_LIVE_ENABLED=true`, além de `NEXUS_CRM_MONTHLY_CHECKOUT_MODE=production`, chave `STRIPE_SECRET_KEY=sk_live_...`, catálogo público homologado. Nenhuma condição isolada gera checkout.
- Configurações em **Supabase Central** `svphwbccqeoakpmcpvhy`, não no Supabase CRM/Agency. Chave service-role continua privada no Edge.
- Assinatura usa `nexus_sales`: `environment=sandbox|production`, `sale_status=lead` até criar session, então `checkout_created`; `billing_mode=recurring`, `billing_cycle_months=1`, `return_origin=CRM_PUBLIC_ORIGIN`, `metadata.nexus_sale_id` para webhook.
- Rate limit transacional `consume_nexus_public_request_limit`: no máximo 3 pedidos por identificador/e-mail por hora, com HMAC. `external_reference` única e idempotency key Stripe reduzem risco de duplicidade. Verificar manualmente comportamento de checkout pendente antes de disponibilizar a novos clientes.
- Validação de documento e dos endereços deve ser confirmada por testes E2E com dados autorizados e CPF/CNPJ reais controlados; não armazenar dados de cartão.
- URLs redirecionadas somente para domínio Stripe permitido no servidor; retorno do Checkout não prova pagamento. **Somente o webhook confirmado libera o CRM**.

## Webhooks e dependências ANTES de publicar

O webhook atual `stripe-webhook` consulta `nexus_sale_id`, persiste pagamentos, chama `provisionCrmTenant` e sincroniza direitos de acesso. No entanto, o fluxo sandbox precisa **do endpoint de webhook com `whsec_` de TESTE e `sk_test_` correspondente**, totalmente isolado de webhooks reais, para não confundir eventos Stripe. Não reutilizar o segredo de live nem publicar checkout sem testes de pagamento, suspensão e cancelamento.

**Gates de homologação:**

- [ ] Revisão técnica: CI com audit, testes sem cobranças, Deno, TypeScript, build.
- [ ] Confirmação de secret de ponte em Next e Central (ambos seguros, não no navegador).
- [ ] Configuração Stripe Payment Method Configuration test/live revisada, cartão somente, id verificado.
- [ ] Sandbox da Stripe: criar Checkout em modo assinatura mensal e completar pagamento com cartão de testes.
- [ ] Webhook de sandbox assinado: venda sai de checkout_created -> paid -> provisioned; organização/CRM corretos; usuário com e-mail existente não duplica.
- [ ] Repetição/replay/webhook fora de ordem não duplica cobrança nem cria tenant duplicado.
- [ ] Simular renovação, inadimplência, cancelamento e reativação.
- [ ] Cadastrar e homologar métodos Pix/boleto do Asaas em fluxo separado, com webhook autenticado e conciliação.
- [ ] Só depois publicar frontend e backend com autorização, seguindo checkpoint Vercel `nexuscoreindustria-create` e `docs/PRODUCTION_DOMAIN_MAP.md`.
- [ ] Habilitar planos públicos e flags *somente depois* de homologação.
- [ ] Conferir jornada end-to-end em ambiente oficial e testar rollback.

## Rollback

Primeiro desligar `NEXUS_CRM_MONTHLY_CHECKOUT_ENABLED` na Central para interromper **novos** checkouts, sem cancelar pagamentos existentes ou impedir webhooks de recibos e assinaturas já vendidas. Reverter o frontend CRM via processo padrão. Nunca simplesmente eliminar assinaturas existentes do provedor para fazer rollback.

## Referências

- Stripe Checkout assinaturas: https://docs.stripe.com/billing/subscriptions/build-subscriptions?payment-ui=checkout&ui=stripe-hosted
- Stripe Pix no Brasil: https://support.stripe.com/questions/how-to-enable-pix-as-a-payment-method-in-brazil
- Asaas assinaturas Pix/boleto: https://docs.asaas.com/docs/assinaturas

## Proteção de contas existentes e agências (24/10/2026)

Antes de criar uma venda ou uma sessão Stripe, o novo endpoint verifica o CPF/CNPJ já cadastrado em `organizations`. Se existir, interrompe com HTTP 409 e orienta o cliente a solicitar vinculação na Central, evitando cobrar duas vezes enquanto a conversão de cortesia/conta existente ainda está na etapa 07. O novo checkout não modifica cortesias.

O contrato de HMAC agora é testado ponta a ponta **sem cobrança**: Node `createHmac` do site assina um corpo JSON e a Central valida com WebCrypto. Testes cobrem alteração do plano/termos/empresa, segredo divergente, assinatura inválida e janela de 5 minutos. Isso substitui a dependência anterior de testes puramente por expressões regulares e ainda exige homologação HTTP após deploy controlado.

## Pix e boleto via Asaas (preparação, SEM habilitar endpoint)

Documento oficial: https://docs.asaas.com/reference/create-a-payments-link e https://docs.asaas.com/docs/assinaturas

- Adicionado `supabase/functions/_shared/crm-asaas-monthly-contract.mjs` e teste `tests/crm-asaas-monthly-contract.test.mjs`: construtor puro do payload de **payment link recorrente** com `billingType` PIX ou BOLETO, `chargeType=RECURRENT`, `subscriptionCycle=MONTHLY`, referência de venda e valor do catálogo. Garante preço em BRL, plano publicamente liberado e ciclo de um mês; impede pacote anual e métodos não autorizados.
- `BOLETO` gera nova fatura mensal; `PIX` convencional também requer ação mensal do pagador — **não** confundir com Pix Automático. Documentação: https://docs.asaas.com/docs/como-o-asaas-trata-receitas-na-conta
- **Este é somente o contrato de criação**; nenhuma chamada à API Asaas ou criação de cobrança foi feita. Os endpoints legados `asaas-create-checkout` e `asaas-webhook` permanecem 410.
- Bloqueio obrigatório: criar função pública nova protegida pela ponte HMAC, segredos Sandbox/Production distintos; criar endpoint de webhook autenticado `asaas-access-token` (32+ caracteres, diferente da API key), persistir evento idempotentemente por `event.id` e retornar HTTP 200 **após persistir**, sem liberar CRM antes de cobrança `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED` vinculada à venda e ao plano. Webhooks são `at least once` e podem chegar fora de ordem. Documentação: https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook
- Nunca usar `success redirect` como prova de pagamento; jamais ativar acesso com link gerado, fatura emitida ou status pendente. Exigir testes de reenvio do webhook, vencimento, pagamento duplicado, reconciliação e suspensão antes de considerar Pix/boleto prontos.

## Desenvolvimento de 24/10 — protótipos Asaas com flags desligadas

- **Novo endpoint distinto** `nexus-public-crm-monthly-asaas` (somente sandbox; não permite modo live): requer HMAC do servidor Next com `NEXUS_CRM_CHECKOUT_BRIDGE_SECRET`, `Origin=https://crm.nexuscore.app.br`, `NEXUS_CRM_ASAAS_MONTHLY_ENABLED=true`, `NEXUS_CRM_ASAAS_MONTHLY_MODE=sandbox`, `ASAAS_SANDBOX_API_KEY`, limite 3/h e plano mensal aprovado pelo catálogo. A exceção de plano `public_visible=false` só pode ser usada no sandbox com `NEXUS_CRM_CHECKOUT_TEST_ALLOW_HIDDEN_PLANS=true`; sem essa flag, não cria link.
- Novo link Asaas `chargeType=RECURRENT`, `subscriptionCycle=MONTHLY`, `billingType=PIX|BOLETO`. O link não prova pagamento, só permite ao pagador iniciar a geração das faturas. Envia referência externa `nexus-crm-monthly-<sale uuid>`; guarda ID/URL validados na tabela `nexus_sales` do produto CRM com `provider=asaas` e `environment=sandbox`. Não altera assinaturas existentes.
- Servidor Next `/api/public/crm-checkout` escolhe Stripe ou Asaas somente conforme método permitido `CARD|PIX|BOLETO`; Pix/boleto exige `NEXUS_ASAAS_CHECKOUT_ENABLED=true` no servidor. Interface exige `NEXT_PUBLIC_NEXUS_ASAAS_METHODS_ENABLED=true` antes de exibir Pix e boleto. **Ambas seguem desabilitadas por padrão**.
- **Novo receptor** `nexus-crm-asaas-monthly-events` recebe webhooks SOMENTE em `NEXUS_CRM_ASAAS_MONTHLY_MODE=sandbox`, `NEXUS_CRM_ASAAS_EVENTS_ENABLED=true`, token próprio **`NEXUS_CRM_ASAAS_EVENTS_TEST_TOKEN`** (32+ chars, configurado no Dashboard Asaas como `authToken` e enviado no header `asaas-access-token`). Eventos de pagamento/assinatura aceitos passam por normalização que elimina PII de clientes e são persistidos em `nexus_payment_webhook_events` com ID `asaas:<event.id>`; duplicatas recebem 200. Erro de persistência recebe 503 para retry do Asaas.
- **IMPORTANTE:** ESTE RECEPTOR APENAS GUARDA EVENTOS. **Ainda não aplica pagamento nem provisiona CRM, nem confirma cancelamento, nem reconcilia faturas**. Antes de permitir Pix/boleto, desenvolver worker reconciliador que verifique `payment.paymentLink` == `nexus_sales.asaas_checkout_id`, o valor == `checkout_amount_cents`, método, situação do pagamento, assinatura, evento antigo/duplicado, assinatura do webhook e evento fresco, e somente então aprove concessão de acesso. Deve impedir que link reutilizado gere várias assinaturas por acidente.
- Evitar confundir `payment.externalReference` do webhook com `link.externalReference`: **o vínculo documentado e confiável é `paymentLink`**. Na assinatura gerada, observar também `payment.subscription` e comparar com ID já reconhecido pela Central.
- Para o novo checkout público já foi incluída proteção contra empresa existente (CPF/CNPJ na Central, HTTP 409 **antes** do provedor) e contra contratações paralelas de ambos os provedores dentro das últimas 24h. Cortesias da agência não são convertidas automaticamente.
- Testes CI sem usar credenciais reais exercitam HMAC Node/WebCrypto, token do webhook, normalização, idempotência, limite mensal, flags e bloqueio de empresa já existente. **Nenhum teste com API Asaas ou webhook ao vivo foi executado nesta rodada.**
- Para ambiente real requer PR separada, autorização de publicação e aprovação do novo reconciliador, testes em sandbox do Asaas, confirmação de acesso CRM e auditoria de cancelamento, devolução, cobrança atrasada e duplicação antes de qualquer habilitação em produção.

Referências: https://docs.asaas.com/docs/criando-um-link-de-pagamentos ; https://docs.asaas.com/docs/eventos-de-webhooks ; https://docs.asaas.com/docs/faq-de-webhooks ; https://docs.asaas.com/docs/como-o-asaas-trata-receitas-na-conta

## 26/10 — Verificação direta de pagamentos Asaas, sem ativação

Adicionada a nova Edge Function privada **`nexus-crm-asaas-verify-event`**, isolada do webhook de recepção, **desligada por padrão** e restrita ao `sandbox`. Sua chamada é somente de servidor administrativo usando **`x-nexus-central-internal-key`** com segredo dedicado **`NEXUS_CRM_ASAAS_VERIFY_SECRET`** (>=32 caracteres), flag `NEXUS_CRM_ASAAS_VERIFY_ENABLED=true`, `NEXUS_CRM_ASAAS_MONTHLY_MODE=sandbox`, `ASAAS_SANDBOX_API_KEY`. Nunca invocar do browser; não aceita URL arbitrária ou evento fornecido diretamente pelo chamador, apenas `eventId` já persistido na Central.

Passos de verificação **read-only**:
1. Recupera o evento financeiro autenticado e guardado em `nexus_payment_webhook_events` e localiza venda Asaas sandbox única vinculada ao `paymentLink` ou assinatura já reconhecida.
2. Faz GETs **pontuais** na API oficial sandbox do Asaas: `/v3/payments/{id}`, `/v3/paymentLinks/{id}`, `/v3/customers/{id}`, `/v3/subscriptions/{id}`. Usa caminho estritamente validado, sem expor chave no cliente.
3. Confere CPF/CNPJ do pagador com o cadastro da venda, valor em centavos do plano, periodicidade MONTHLY, meio PIX/BOLETO, `externalReference` do link, identificador do assinante e status **atual** no Asaas. Eventos antigos de pagamentos agora estornados **não** podem ser considerados quitados.
4. Retorna `verified_for_review` apenas como **candidato para conciliação**, com `canActivateCrm:false`. Qualquer divergência retorna `hold`, `manual_review` ou `retry`. Esta função **NÃO altera `nexus_sales`, `nexus_payment_webhook_events`, `nexus_payments`, `organization_product_access` ou o tenant CRM**, e não envia e-mail.
5. Testes com leitor Asaas simulado (sem API real) cobrem confirmação, estorno, CPF/CNPJ divergente, assinatura e link errados, método, valor alterado, plano anual e proteção de endpoints.

Documentação oficial consultada: https://docs.asaas.com/reference/retrieve-a-single-payment ; https://docs.asaas.com/reference/retrieve-a-single-payments-link ; https://docs.asaas.com/reference/retrieve-a-single-subscription . A API do Asaas recomenda GET pontual para recuperação e reconciliação, não polling contínuo.

**Ainda é BLOQUEADOR para liberar clientes:** desenvolver e revisar fluxo transacional de baixa da cobrança `provider_payment_id`, vinculação da assinatura, provisionamento CRM usando mecanismos de revisão/entitlement já empregados no Stripe, proteção contra concorrência, repetição, cancelamento, atraso e estorno. O teste histórico do Stripe Sandbox de 03/09/2026 permanece válido; não criar outro usuário de teste sem necessidade. Nenhuma chave/flag configurada e nenhum deploy realizado nesta rodada.
