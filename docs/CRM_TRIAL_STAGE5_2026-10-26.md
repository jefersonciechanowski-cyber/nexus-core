# Nexus CRM — Etapa 05: testes gratuitos administrativos (15 / 30 dias)

**Situação em 26/10/2026:** implementação revisável em PR draft da Central #104; testes offline, segurança, Deno e build aprovados. **NÃO publicada, NÃO aplicada no banco, NÃO homologada E2E.** Etapa 05 ainda não acrescenta pontos no checklist oficial.

## Regra comercial definida

- **Pacotes da agência / cortesia na Central:** serviço **nexus-admin-crm-courtesy** mantém exatamente os períodos de 1 a 24 meses e `commercial_condition='courtesy'`. Nunca alterar/gratuitamente converter estes contratos em pagamentos nem limitá-los a 15/30 dias.
- **Teste gratuito do CRM:** somente o **administrador Nexus** pode conceder **15 ou 30 dias** pelo endpoint separado `nexus-admin-crm-trial`; conta nova, CPF/CNPJ válido de formato, e-mail, plano mensal Start/Pro/Gestão. `subscription_status='trial'`, `commercial_condition='standard'`, `billing_provider=null`, preço R$ 0, `starts_at` e `renews_at` (fim) explícitos.
- **Cliente direto do site:** contratação mensal com aceite de cobrança. **Fim de teste não cria automaticamente checkout, cobrança ou assinatura.** Conversão será fluxo autenticado explícito, vinculado ao tenant existente (etapas 06–07); não tentar recriar conta por checkout anônimo.

## Proteções existentes no código, ainda default-off

1. Feature flag **`NEXUS_CRM_TRIAL_GRANTS_ENABLED=true`** no Supabase Central antes de aceitar POST; ausência da flag devolve 503.
2. Autenticação de usuário via Supabase Auth, garantia **MFA AAL2** e perfil **`nexus_admin` ativo**. CORS restrito aos domínios administrativos permitidos.
3. Contrato `crm-trial-contract.mjs`: só aceita 15 ou 30 dias, IDs de plano UUID e CPF/CNPJ em formato compatível com schema; datas UTC em dias corridos.
4. Verifica Central `organizations` por e-mail e documento, não reaproveita nem altera outra organização, cortesia, founder ou contrato pago. Não faz deduplicação de usuário por coincidência de e-mail; fase 07 terá vinculação autenticada e testes de colisão.
5. Before any INSERT/tenant, requer RPC `reserve_nexus_crm_trial` com **fingerprints HMAC** de e-mail e documento usando um segredo privado distinto `NEXUS_CRM_TRIAL_FINGERPRINT_SECRET` (>=32 chars), guardas de unicidade do banco por e-mail **OU** CPF/CNPJ. O segredo nunca sai do servidor. Falha da RPC = bloqueia criação.
6. Após provisionamento via `provisionCrmTenant`, a RPC `confirm_nexus_crm_trial` exige o mesmo acesso CRM, `trial`, preço zero e nenhuma billing provider. Em erro parcial bloqueia novo cadastro e exige revisão administrativa, preservando dados existentes.
7. Painel administrativo `apps/nexus-admin/crm-access.html` traz formulário próprio para teste de 15/30 dias. Ele fica **oculto por padrão**, até que a configuração confiável da UI exponha `window.NEXUS_CRM_TRIALS_ENABLED=true` somente após a homologação. Não basta ligar o front-end: a flag backend e as RPCs de validação também devem estar corretas.
8. **Expiração**: `nexus-crm-trial-reconcile` exige `NEXUS_CRM_TRIAL_RECONCILE_ENABLED=true` e token OIDC GitHub válido com audience `nexus-crm-trial-reconcile`, repository e ref main, disparo `schedule` ou `workflow_dispatch`. A RPC `expire_nexus_crm_trial_access` trava o contrato e só suspende `crm + standard + trial + R$0 + sem billing provider + claim confirmada + renews_at<=data atual`. O worker envia alteração de entitlement por `syncCrmEntitlement` (outbox de retry existente), sem excluir usuário/tenant.
9. Os scripts SQL para `reserve`, `confirm` e `expire` estão **APENAS no documento `docs/CRM_TRIAL_CLAIM_SQL_DRAFT.sql`**. NÃO foram rodados, migrados nem testados contra PostgreSQL isolado. A migração oficial requer revisão e homologação com concorrência/replay, além do serviço de expiração agendado. **Não ativar grants antes de garantir o expirer.**

## Gates obrigatórios antes de considerar a etapa 05 concluída

- [x] Separação lógica de teste 15/30 dias x cortesia de meses e pagamento direto do site
- [x] Administrador autenticado + MFA2 + feature flags + identidade deduplicada por reserva proposta
- [x] Validação offline: períodos, datas UTC, fingerprints, contratos intactos, testes segurança, Deno e build
- [ ] Revisar migração com privilégios mínimos e testar em banco **isolado**, com chamadas simultâneas de mesmo e-mail ou mesmo CPF/CNPJ
- [ ] Teste E2E real Central → tenant CRM → primeiro acesso (15 e 30 dias)
- [ ] Confirmar expiração após vencimento e sincronização do status ao CRM; simular falha/retry
- [ ] Implementar conversão paga autenticada no mesmo tenant, sem cobrança automática ou perda de dados
- [ ] Confirmar ambiente/domínios, revisar publicação e rollback conforme procedimento de checkpoint humano

**Critério do checklist #80:** etapa 05 só soma 10% após E2E e aprovação em ambiente adequado. A etapa 04 de pagamentos é pré-requisito para conversão paga.
