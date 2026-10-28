# Supabase Nexus Central — migrações instaladas em 28/10/2026

Projeto: `svphwbccqeoakpmcpvhy` (`nexus-core-producao`). Nenhum segredo registrado neste documento.

## Histórico de migrações aplicadas (Supabase MCP apply_migration)

1. `crm_asaas_trial_reservation_tables_20261028`: estruturas `nexus_crm_asaas_verified_payments` e `nexus_crm_trial_claims`, com unicidade, RLS deny-all e revogação de privilégios públicos. Fonte: DDL de `docs/CRM_ASAAS_SETTLEMENT_RESERVATION_SQL_DRAFT.sql` e `docs/CRM_TRIAL_CLAIM_SQL_DRAFT.sql`, apenas o segmento anterior às funções.
2. `crm_asaas_sandbox_service_role_workflow_20261028`: exatamente cinco funções Asaas dos arquivos `docs/CRM_ASAAS_SETTLEMENT_RESERVATION_SQL_DRAFT.sql`, `CRM_ASAAS_PAYMENT_CLAIM_SQL_DRAFT.sql`, `CRM_ASAAS_PROVISION_LEASE_SQL_DRAFT.sql` e `CRM_ASAAS_LIFECYCLE_SQL_DRAFT.sql`; o segmento após `CREATE OR REPLACE FUNCTION`, sem reaplicar tabelas.
3. `crm_trial_service_role_claims_20261028`: três funções administrativas de claim/confirmação/expiração do trecho de funções em `docs/CRM_TRIAL_CLAIM_SQL_DRAFT.sql`.

**Verificações após instalação:** tabelas têm RLS ativado, zero policies, `anon/authenticated` sem SELECT/INSERT; oito funções novas com SECURITY DEFINER, `service_role EXECUTE=true`, `anon/authenticated EXECUTE=false`. O Supabase advisor RLS-no-policy é INFO intencional: negar tudo a clientes. Nenhuma das doze funções SECURITY DEFINER antigas foi modificada.

**Zero efeitos nos clientes no momento da instalação:** não houve concessão trial, provisionamento, suspensão, reserva financeira ou venda. Em read-only: vendas mensais Asaas 0, reservas 0, trials 0, planos públicos 0, webhooks Asaas novos 0. Seis Edge Functions Asaas/trial e checkout Stripe permanecem HARD OFF.

**Observação de auditoria:** cabeçalhos originais dos SQLs acima dizem `REVIEW ONLY`/`NOT APPLIED`; estão desatualizados a partir desta data. Os conteúdos funcionais foram promovidos após aprovações na CI PR #109 (PostgreSQL 17 isolado) e conferência do schema real, mas os arquivos de origem foram mantidos para rastreabilidade. Nenhum SQL de migração deve ser executado novamente manualmente: conferir histórico Supabase.

**Não autoriza comercialização:** ainda falta link Asaas Sandbox Pix/boleto RECURRENT/MONTHLY, webhook com token distinto da API key, conciliação E2E e novo cliente piloto, e trial 15/30 dias com teste de expiração. Nenhum checkout real deve ser ativado antes disso.
