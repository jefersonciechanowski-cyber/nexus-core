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
