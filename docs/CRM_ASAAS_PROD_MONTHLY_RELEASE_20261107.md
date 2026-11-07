# Nexus CRM — Asaas mensal produção: checklist sem novos depósitos

Data: 07/11/2026. Esta etapa não cria cobrança, cliente ou assinatura; o primeiro Pix real de R$10 já foi homologado como **avulso**, não como mensalidade.

## Componentes prontos nesta PR
- Checkout novo e separado: `nexus-public-crm-monthly-asaas-production`, **HARD OFF** no código. O handler antigo permanece exclusivamente Sandbox, o Stripe continua protegido.
- Usa a conta Asaas de produção somente com `ASAAS_PRODUCTION_API_KEY` e host fixo `https://api.asaas.com/v3`.
- HMAC independente `NEXUS_CRM_ASAAS_PROD_CHECKOUT_BRIDGE_SECRET` e três gates separados, todos necessários, além do HARD OFF, antes de realizar qualquer operação:
  `NEXUS_CRM_ASAAS_PROD_CHECKOUT_ENABLED`, `NEXUS_CRM_ASAAS_PROD_SETTLEMENT_READY`, `NEXUS_CRM_ASAAS_PROD_WEBHOOK_CONFIRMED`.
- Valor derivado do plano ativo e público da Nexus Central; recorrência `RECURRENT/MONTHLY`, Pix ou boleto. Link Asaas tem `limit: 1`.
- RPC de preflight de CPF/CNPJ e e-mail; os índices únicos existentes de documento/e-mail por ambiente e entre Asaas/Stripe bloqueiam concorrência. Resultados externos incertos mantêm venda em revisão **sem permitir outro link**.
- Tabela de recebimento de eventos Asaas de produção, privada com RLS e acesso interno, isolada do Sandbox. A Edge Function de eventos permanece **HARD OFF** no código.
- CI executa testes estáticos + typecheck Deno + testes de SQL no PostgreSQL 17, sem conexões com o provedor.

## Bloqueios antes da venda pública
1. Worker Asaas de produção **deve** ler eventos da inbox e confirmar pagamento/link/cliente/assinatura por quatro GETs independentes; jamais confiar apenas no webhook.
2. Reserva financeira, claim e lease são atualmente Sandbox-only e exigem revisão de autorização e isolamento em produção antes de modificar `nexus_sales`/acesso. Liberação deve ocorrer apenas após pagamento recebido e idempotente.
3. Provisionar organização e tenant no CRM, criar acesso e gerar email único; sem reenvio do link consumido do piloto anterior.
4. Reconciliação de **renovações** deve persistir recibos por ciclo e sincronizar entitlements. Atrasos, suspensão após carência, estorno e cancelamento exigem política expressa e testes de ordem e duplicidade de eventos.
5. Revisar remetente de domínio Nexus e testar comunicação. Confirmar abertura do frontend e publicação autorizada.
6. Verificar saúde da chave Asaas de produção **somente leitura**. Não criar pagamentos de teste.

## Liberação
A implantação de componentes bloqueados não significa go-live. Não remover os HARD OFF ou ativar flags até cumprir a cadeia financeira e obter aceite operacional explícito. Não exigir depósitos do operador.
