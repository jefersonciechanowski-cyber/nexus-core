# Nexus CRM — orquestração dos eventos Asaas de produção

Estado: **implementada para monitoramento, processamento financeiro bloqueado**.
Data de revisão inicial: 07/11/2026.

## Arquitetura

1. O Asaas publica `PAYMENT_*` e `SUBSCRIPTION_*` no endpoint
   `nexus-crm-asaas-production-events`.
2. O receptor autentica `asaas-access-token`, minimiza o JSON,
   grava na tabela `nexus_crm_asaas_production_events` e devolve
   `HTTP 200` após persistir. Não liquida nem provisiona.
3. O workflow do GitHub
   `.github/workflows/crm-asaas-production-dispatch.yml`
   executa inspeção somente leitura a cada 6 horas; inclui também uma agenda
   de 5 minutos cujo job é **ignorado** por padrão e só roda quando a
   variável GitHub `NEXUS_CRM_ASAAS_PROD_FINANCIAL_WORKFLOW_ENABLED=true`
   for aprovada.
   Ele obtém um **JWT OIDC de curta duração**, audience
   `nexus-crm-asaas-production-dispatch`; não armazena segredos em
   GitHub. Sem opt-in, **solicita somente `{"action":"inspect"}`**.
4. A Edge Function nova
   `nexus-crm-asaas-production-dispatch` valida assinatura JWT,
   issuer, audience, repositório, branch `main`, evento e
   `workflow_ref` **exato** antes de consultar a fila.
5. A inspeção agrega apenas contagens `pending` e
   `manualReview`, sem divulgar cliente, CPF/CNPJ, token ou valores.
6. O algoritmo já diferencia primeira contratação, renovação e
   casos que exigem revisão, usando vínculo único por checkout,
   assinatura, empresa e produto. O encaminhamento financeiro, quando
   aprovado futuramente, chama apenas workers privados que precisam
   rever pagamento na API Asaas e têm suas próprias travas e leases.

## Proteção de lançamento

O código possui
`const PRODUCTION_FINANCIAL_DISPATCH_DISABLED = true`.
**Não remover nem mudar** enquanto não existirem:
- evento **real**, originado no Asaas produção, com `HTTP 200` no log e
  ID idêntico gravado no banco;
- credenciais internas independentes para cada worker, nunca reutilizando
  token de webhook ou chave Asaas;
- verificação de pagamento, plano, assinatura, titular, tenant e valor;
- prova ponta a ponta do checkout assinado até usuário, e-mail, acesso
  e reconciliação de pagamentos;
- política de inadimplência e reativação aprovada, com envio de aviso,
  opt-in de tarifas de notificações e controle de revisões;
- revisão operacional expressa da alteração dos gates dos workers e do
  checkout.

O passo financeiro do workflow é opt-in e NÃO executa em eventos `push`.
A variável GitHub habilita apenas o agendamento, não altera os bloqueios
de código ou os segredos da Central; um dispatcher com HARD OFF devolve
503 e o job falha de forma visível. Por padrão, **nenhum evento é liquidado**.
Quando aprovado, a agenda de 5 minutos facilita a entrega inicial e o
reprocessamento idempotente, mas o GitHub Actions não oferece SLA exato
de minuto; o produto deve monitorar atrasos e falhas do agendamento.

As demais flags `NEXUS_CRM_ASAAS_PROD_DISPATCH_ENABLED`,
`NEXUS_CRM_ASAAS_PROD_SETTLEMENT_READY` e
`NEXUS_CRM_ASAAS_PROD_WEBHOOK_CONFIRMED` também precisam ser
habilitadas separadamente, mas **flags isoladas não levantam
o bloqueio de código**.

Não se pode classificar monitoramento, teste de token interno ou
aprovação de CI como confirmação de entrega real ou faturamento
homologado.

## O que não ocorre

Nenhuma tentativa de pagamento, novo Pix de R$10, assinatura, link
de checkout, envio de e-mail ou suspensão automática é realizada
pelo monitor. Mesmo após habilitar o processamento em uma etapa
futura, eventos de atraso, cancelamento, estorno e chargeback são
encaminhados à revisão, nunca geram corte automático de acesso.

Este fluxo não toca nos projetos SST Controle ou Agency.

## Referências

- https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook
- https://docs.asaas.com/docs/faq-de-webhooks
- https://docs.github.com/en/actions/reference/security/oidc
- https://supabase.com/docs/guides/functions/auth-headers
