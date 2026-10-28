# Nexus CRM — Etapa 06: ciclo de vida de assinatura Asaas (somente rascunho)

**Situação:** branch `feat/crm-monthly-checkout-20261023`; nenhum merge, deploy, banco Supabase alterado, cobrança ou gasto de infraestrutura contratado. PostgreSQL 17 efêmero no GitHub Actions executa dados **artificiais**. Atualizações do CRM/tenant em produção **não estão habilitadas**.

## Estados (referências oficiais)

Assinatura Asaas **INACTIVE** deixa de gerar novas cobranças, mas preserva as anteriores; remoção **DELETED** encerra a recorrência. Pix/boleto convencionais exigem pagamento a cada fatura e uma notificação `PAYMENT_OVERDUE` pode chegar antes de se decidir sobre tolerância. Referências:
- https://docs.asaas.com/docs/faq-assinaturas
- https://docs.asaas.com/docs/eventos-para-assinaturas
- https://docs.asaas.com/reference/remover-assinatura

O contrato Nexus não pode equiparar atraso a cancelamento nem reabrir a conta depois de um cancelamento terminal.

| Evento Asaas | Prova adicional obrigatória | Estado proposto Central | Política |
|---|---|---|---|
| PAYMENT_OVERDUE | Conferência da cobrança, regra de tolerância | sem mudança | revisão manual até prazo de tolerância acordado |
| SUBSCRIPTION_INACTIVATED | Assinatura atual INACTIVE | past_due / suspended | preservar tenant e dados |
| PAYMENT_REFUNDED | Mesmo pagamento associado ao contrato, estado atual REFUNDED | past_due / suspended | não apagar informações |
| PAYMENT_RECEIVED / PAYMENT_CONFIRMED | Cobrança pertencente ao contrato e status atual RECEIVED/CONFIRMED, assinatura ACTIVE | active / active | somente se não cancelado; entrega de entitlement |
| SUBSCRIPTION_DELETED | Remoção comprovada independentemente no Asaas | cancelled / suspended | terminal: não reativar com webhook antigo |
| PAYMENT_CHARGEBACK_* | Revisão de disputa | sem mudança automática | escalonamento financeiro |
| Evento duplicado/antigo | Comparação de ID, timestamp e estado | sem mudança | idempotência / ordem |

## Código e testes (sem efeitos externos)

- `supabase/functions/_shared/crm-asaas-lifecycle.mjs`: função pura (sem chamadas HTTP/SQL) classificando `candidate`, `hold`, `manual_review` após prova externa. Não abre conta, não apaga dados, não cobra.
- `docs/CRM_ASAAS_LIFECYCLE_SQL_DRAFT.sql`: **somente SQL de revisão; NÃO aplicado**. RPC serviço `apply_nexus_crm_asaas_lifecycle` com lock na linha de acesso, isolamento de `billing_provider='asaas'`, produto CRM, condição `standard`, contrato mensal, venda Asaas sandbox provisionada e `nexus_payments` pertencente ao acesso. Exige evento no inbox autenticado, proíbe duplicata/obsoleto, mantém `cancelled` terminal; propõe atualizar estado Central. **O campo `p_verified_status` não é prova autônoma**: o worker interno precisa buscar novamente o Asaas e rejeitar snapshots falsos/desatualizados antes de chamar a RPC. NENHUM worker já chama esta RPC.
- `tests/crm-asaas-lifecycle.test.mjs`: 8 cenários de decisão com contrato existente, autenticação, status externo, duplicatas, terminal, proteção de cortesia e cobrança de outra empresa.
- `tests/sql/crm_lifecycle_fixture.sql` + `tests/sql/crm_lifecycle_assertions.sql`: contrato Asaas fictício e sete eventos com data relativa; aplica a RPC no PostgreSQL 17 temporário e valida a passagem **ativo → suspenso → ativo → suspenso → ativo → cancelado**, tentativa de recuperação terminal e não alteração de cortesias/Stripe. O evento `PAYMENT_OVERDUE` não suspende automaticamente.
- CI Central Security **#40338749702 SUCCESS**: auditoria, testes Node, SQL 17 com concorrência, Deno typecheck e Cloudflare build; logs `PASS: lifecycle refund/inactive/paid/deleted/terminal + courtesy isolation (PG17)`.

## Gates antes de ativar cobrança/assinatura de cliente real

1. Implementar worker autenticado (server-only) que valide o token/evento original e confira **os estados atuais** do pagamento e assinatura diretamente no Asaas, incluindo confirmação confiável da remoção e do titular. Sem provider GET + verificação, não chamar SQL de atualização.
2. Integrar baixo risco com provisionamento e `syncCrmEntitlement` que já entrega atualizações assinadas ao CRM; confirmar reconciliação `crm_sync_revision` em caso de falha/retry. Exigir tenant vinculado, não eliminar dados do cliente.
3. Decidir política de vencimento/tolerância em dias com o responsável antes de permitir suspensão por `PAYMENT_OVERDUE`.
4. Validar comportamento com faturas reais de **Asaas Sandbox** + eventos reais do provedor e assinatura cancelada, *sem cobrar em produção*.
5. Revisar migrações e permissões no banco **sem custos adicionais**, preservar cortesias e founder, além de garantir sandbox/rollback. Não executar arquivos `*_DRAFT.sql` diretamente no Central de produção.
6. Só então concluir etapa 06 (10% no checklist) e liberar PR/merge e publicação por checkpoint humano com autorização própria.

**Limite de evidência:** PostgreSQL de CI usa uma fração sintética do schema, portanto sucesso dos SQLs nesta branch não demonstra homologação E2E no Supabase de produção, Asaas real ou entrega ao CRM. O checklist oficial permanece em 25% até esses gates.
