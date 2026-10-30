# Nexus CRM — prévia privada do ciclo de cobrança Asaas

**Escopo:** revisão de código e testes offline no Sandbox. Nenhuma assinatura,
cobrança, tenant ou permissão é criada ou modificada nesta etapa.

## Componentes
- `supabase/functions/_shared/crm-asaas-lifecycle-preview.mjs`: motor puro. Confirma vínculo, documento, valor, pagamento, assinatura e ordenação do evento. Retorna apenas candidato/revisão/retenção.
- `supabase/functions/nexus-crm-asaas-lifecycle-preview/index.ts`: endpoint privado, desligado por padrão. Aceita **somente** `POST` com JSON `{"eventId":"asaas:evt_..."}`.
- `tests/crm-asaas-lifecycle-preview.test.mjs`: testes locais sem chamadas reais à API nem pagamentos.

## Restrições
1. Só Sandbox com `NEXUS_CRM_ASAAS_MONTHLY_MODE=sandbox` e flag `NEXUS_CRM_ASAAS_LIFECYCLE_PREVIEW_ENABLED=true` (não configurar até homologar). Segredo exclusivo `NEXUS_CRM_ASAAS_LIFECYCLE_PREVIEW_SECRET` no header interno `x-nexus-asaas-lifecycle-preview-key` com mínimo de 32 caracteres. Nunca usar no navegador, código público ou webhook.
2. A consulta não aceita IDs de empresa, usuário, acesso ou pagamento no corpo. Todas as relações derivam do evento já gravado na Central, exigindo empresa/CRM, mesmo access, mesma assinatura e venda Asaas Sandbox **já provisionada**.
3. Eventos de pagamento exigem registro único em `nexus_payments`, com `provider_payment_id`, `access_id`, `organization_id`, assinatura, moeda BRL e valor iguais. Um pagamento de **renovação ainda sem recibo independente** permanece em revisão: a rotina não cria recibos nem pressupõe quitação.
4. GET autenticado na API Sandbox de assinatura, pagamento e cliente, com host fixo, IDs validados, limite de resposta e timeout. Compara documento com venda e relacionamento do pagador/assinatura antes da classificação.
5. `PAYMENT_RECEIVED` / `PAYMENT_CONFIRMED`: pode **sugerir** reativação de assinatura existente quando os dados batem. `PAYMENT_REFUNDED` e `SUBSCRIPTION_INACTIVATED`: podem **sugerir** suspensão.
6. `PAYMENT_OVERDUE` não gera corte sem definição formal de tolerância. `SUBSCRIPTION_DELETED` não cancela automaticamente enquanto a exclusão não puder ser comprovada de forma independente. Chargeback continua para revisão manual.
7. Eventos antigos, repetidos, futuros, de outros provedores, cortesias, empresas diferentes e mudanças sem nota financeira válida são recusados. Nenhuma mensagem externa ou documento é retornado ao cliente.
8. **Nenhum** RPC de mutação, envio de e-mail, criação de tenant, cobrança ou mudança em `organization_product_access` ocorre no endpoint.

## Critério para a etapa futura
Homologar a prévia de renovação, estorno e cancelamento sem alterações.
Somente em uma PR posterior e com autorização explícita deve ser considerada
uma rotina de aplicação de mudanças com idempotência, assinatura válida,
política de carência e sincronização do CRM.

## Regra de deploy
A branch de preparação é `feat/crm-asaas-lifecycle-readonly-20261030`
no repositório **Nexus Central** `jefersonciechanowski-cyber/nexus-core`.
Não alterar `deploy/meta-account-scope-production` no repositório
`nexuscoreindustria-create/nexus-crm`. Não fazer merge, publicar no
Supabase ou ativar flags por causa desta mudança sem aprovação posterior.
