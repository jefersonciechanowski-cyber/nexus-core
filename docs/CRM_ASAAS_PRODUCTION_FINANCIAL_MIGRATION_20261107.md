# Nexus CRM — Asaas mensal, migration de conciliação produção

Atualização: 07/11/2026. A migração versionada
`supabase/migrations/20261107223000_crm_asaas_production_settlement.sql`
cria uma reserva financeira exclusiva da produção e quatro RPCs internas
`service_role`, protegidas por RLS, validação de origem, lock e idempotência.

A tabela de eventos da produção já estava criada e protegida; este SQL não
recebe webhooks externos, não chama Asaas, não cria cobrança, não envia
e-mail, não concede acesso e não modifica contratos existentes.

**Importante:** a migração não ativa o produto. Os seguintes endpoints
permanecem HARD OFF no código: checkout mensal Asaas produção, inbox de
webhooks, verificador e provisionador. Ativação exige revisão dos webhooks
Asaas de produção e configuração de segredos exclusivos, conferência de
pagamento por quatro GETs, sincronização do CRM, política de renovação/
inadimplência e aprovação de liberação.

O teste Pg17 de CI usa dados inventados e comprova que um evento de Sandbox
não pode reservar pagamento de produção, duplicatas não criam duas reservas,
uma venda só muda para `paid` sob claim financeiro e lease é exclusivo. A
função de conclusão recusa finalizar sem usuário, contrato, tenant e recibo.

O piloto real Pix R$10 pré-pago continua separado, com acesso até
07/12/2026. Não fazer novo depósito para validar o checkout mensal.
