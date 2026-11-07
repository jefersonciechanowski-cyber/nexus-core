# CRM Asaas — vencimento de pré-pago (07/11/2026)

Esta etapa trata o contrato real de **R$10, pagamento Pix avulso**, sem assinatura.
O registro atual permanece com `renews_at = 2026-12-07` e **não deve ser suspenso antecipadamente**.

A nova RPC `expire_nexus_crm_asaas_prepaid_access` é exclusiva de `service_role`, protegida por lock e idempotência. Ela exige contrato CRM Asaas pré-pago, condição `standard`, tenant vinculado, assinatura externa ausente e comprovante `RECEIVED` coerente. Só suspende quando `renews_at < data UTC atual` (após o último dia de vigência). Preserve documentos/dados do CRM.

O workflow de reconciliação existente, autenticado com OIDC GitHub, passa a ter um ramo exclusivo Asaas protegido por **`NEXUS_CRM_ASAAS_PREPAID_EXPIRY_ENABLED=true`**. Sem essa variável, **não há suspensão Asaas**. Após a transição, entrega entitlement ao CRM pela fila assinada, com retry de revisão pendente. Não cria cobrança nem faz cobrança ou assinatura automática.

## Operação segura
1. Revisar migração e SQL da PR, inclusive privilégios, CI PG17 e `security:check`.
2. Aplicar a migração somente com autorização de produção e confirmar função/permissões. A implantação do worker é separada.
3. Antes de ativar gate, validar execução privada com cenário vencido **sintético** e recebimento de entitlement no CRM, preservando o contrato real.
4. Até essa homologação, **gate OFF**. Nenhum novo Pix ou disparo de cobrança.
5. O mês recorrente Asaas (assinatura) é **um fluxo diferente** e não é habilitado nesta PR.
6. Política do pré-pago: suspender **no dia seguinte à data final**, não por evento de boleto/assinatura vencida. A política de carência de assinaturas recorrentes permanece pendente de definição e testes.
