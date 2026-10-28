# Nexus CRM — Pagamento Asaas → Baixa → Provisionamento (26/10/2026)

**Estado: branch de desenvolvimento; IMPLEMENTAÇÃO DESLIGADA; ainda NÃO homologado com Asaas Sandbox real nem com a infraestrutura Supabase/CRM implantada.**

Restrições combinadas: **nenhum custo adicional, cobrança real, criação de serviços, alteração de cortesia/agência, merge ou deploy**. PR Central #104 draft; PR CRM/site #87 draft, `deploy/meta-account-scope-production` intocada.

## Pipeline em ordem, sem acesso prematuro

1. O webhook Asaas armazena o evento financeiro de forma idempotente. **Não cria tenant.**
2. A função interna `nexus-crm-asaas-verify-event` (ou o worker de provisionamento) consulta a API **Asaas Sandbox** para o pagamento, link, pagador e assinatura, conferindo CPF/CNPJ, preço em centavos, plano mensal, método, externalReference, status atual e IDs. Evento antigo estornado ou pendente não é prova.
3. O módulo `crm-asaas-settlement-pipeline.mjs` exige `verified_for_review`, evento vinculado e flags independentes. RPC `reserve_nexus_crm_asaas_verified_payment` grava prova com idempotência; RPC `claim_nexus_crm_asaas_provisioning` muda financeiramente a venda a `paid` em uma transação, protegendo documento/e-mail contra outra compra concorrente.
4. **NOVO:** `begin_nexus_crm_asaas_provisioning` reserva exclusividade `provision_ready → provisioning` no banco. Somente uma execução pode iniciar a criação do usuário/empresa. Lease **não expira automaticamente**: queda ou falha parcial requer revisão manual para não criar cadastros duplicados.
5. **NOVO:** `nexus-crm-asaas-provision` é Edge Function **interna**, POST limitado a ID do evento já persistido, token privado `x-nexus-central-internal-key`, flag `NEXUS_CRM_ASAAS_PROVISION_ENABLED` **OFF**. Recheca o Asaas Sandbox e a reserva, claim e lease **antes** de chamar o provisionamento compartilhado.
6. **NOVO:** `crm-asaas-payment-record.mjs` confere a reserva em estado `provisioning` e grava em `nexus_payments` apenas o pagamento do **mesmo** `organization_id`, `access_id`, assinatura, titular, valor e método. A restrição única `provider_payment_id` já existe no schema Central real. Replays exatos são aceitos sem novo INSERT; cobrança associada a outra empresa é **bloqueada**. Uma falha de pagamento causa `manual_review`, **antes de criar o tenant CRM ou enviar acesso**.
7. `provisionSaleForProvider(..., provider:'asaas')` reutiliza as verificações de usuário/organização/tenant/e-mail da Stripe e **não adota e-mail de terceiro nem sobrescreve cortesia**. Em falha após começar a criação, o lease permanece `provisioning` para revisão manual. Não tentar iniciar novamente automaticamente.
8. **NOVO:** RPC `complete_nexus_crm_asaas_provisioning` valida venda `provisioned`, organização, usuário, entitlement ativo, tenant vinculado e registro financeiro único; somente então marca a reserva `provisioned`. Se falhar, não disparar novamente a criação de usuários.

## Operação: flags todas desativadas por padrão

A habilitação de cobrança mensal Asaas **não ocorre** por merge de código. É necessário autorizar e configurar separadamente, somente em sandbox:
- `NEXUS_CRM_ASAAS_MONTHLY_MODE=sandbox`
- `NEXUS_CRM_ASAAS_VERIFY_ENABLED=true`
- `NEXUS_CRM_ASAAS_RESERVATION_ENABLED=true`
- `NEXUS_CRM_ASAAS_CLAIM_ENABLED=true`
- `NEXUS_CRM_ASAAS_PROVISION_ENABLED=true`
- `NEXUS_CRM_ASAAS_VERIFY_SECRET` (segredo privado >=32 caracteres, não expor)
- `ASAAS_SANDBOX_API_KEY` (somente chave de teste, nunca live)
- `SUPABASE_SERVICE_ROLE_KEY` é server-only no ambiente Central, nunca no browser.

**IMPORTANTE:** Nenhuma flag/chave foi alterada em Supabase. A nova função não foi implantada. Nenhum cliente recebe acesso automático nesta rodada.

## Scripts de revisão — NÃO aplicar em produção

1. `docs/CRM_ASAAS_SETTLEMENT_RESERVATION_SQL_DRAFT.sql` (ledger com novo estado `provisioning`).
2. `docs/CRM_ASAAS_PAYMENT_CLAIM_SQL_DRAFT.sql` (baixa financeira + proteção identidade).
3. `docs/CRM_ASAAS_PROVISION_LEASE_SQL_DRAFT.sql` (lease one-shot + confirmação).

Estes arquivos foram testados em PostgreSQL 17 efêmero na CI com dados fictícios, **não representam migrações Supabase aprovadas ou aplicadas**. Requerem revisão com schema e segurança completos, conversão para migrações oficiais, teste local isolado e autorização específica de implantação.

## Evidência de testes

- `tests/crm-asaas-payment-record.test.mjs`: proprietário, preço, recibo único, repetição idempotente, conflito, erro de banco e ordem do tenant.
- `tests/crm-asaas-provision-worker.test.mjs`: flags, segredo, endpoint sandbox, recibo antes da liberação e cancelamento de retries automáticos.
- `tests/sql/crm_asaas_provision_lease_assertions.sql`: transição `provision_ready→provisioning→provisioned`, dupla aquisição, tentativa de conclusão sem tenant ou sem recibo e proteção de cortesia.
- CI `Security`: Node, Deno `check`, PostgreSQL 17 isolado + concorrência, CSP/security e Cloudflare build.
- Testes usam **dados artificiais**; nenhum HTTP de pagamento nem usuário real foi criado.

## Pendências que ainda bloqueiam comercialização

- Homologação **real no Asaas Sandbox** com eventos e cancelamento; confirmar método PIX/boleto, status, assinatura e atualizações fora de ordem.
- Testar autenticação e permissões do provisionador na infraestrutura completa de Supabase local (gratuita) e a entrega assinada Central → CRM, com primeiro acesso real e e-mail.
- Criar caminho **autenticado e auditado** para cliente com e-mail/empresa preexistentes; sem tomar acesso de cortesia ou recriar tenant.
- Revisar casos de falha depois de enviar e-mail mas antes da confirmação final, meios de recuperação manual e alertas operacionais.
- Homologar renovação, cancelamento, vencimento e estorno com dados do provedor, teste gratuito 15/30 e pilotos externos.
- Seguir regra humana de deploy e aprovação em produção. **Progresso oficial 25%** até a homologação E2E; não declarar esta etapa concluída só porque CI está verde.
