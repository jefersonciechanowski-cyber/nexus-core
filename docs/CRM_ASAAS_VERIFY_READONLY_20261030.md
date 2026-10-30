# Nexus CRM — Asaas Sandbox: verificação privada somente leitura

**Fase 1, sem cobranças novas.** Reutilizar o pagamento do checkout originado no CRM em 30/10/2026 (R$ 79, boleto Sandbox); não repetir a contratação.

A Edge Function `nexus-crm-asaas-verify-event` passa a consultar exclusivamente o provedor **Asaas Sandbox** para conferir pagamento, link recorrente, cliente/documento e assinatura. Esta fase **não** chama RPCs financeiras, não altera `nexus_sales`, não cria reserva, usuário, organização ou acesso.

**Autenticação obrigatória:** `NEXUS_CRM_ASAAS_VERIFY_ENABLED=true`, `NEXUS_CRM_ASAAS_MONTHLY_MODE=sandbox` e `NEXUS_CRM_ASAAS_VERIFY_SECRET` (servidor, 32+ caracteres, diferente do webhook, do checkout HMAC e do piloto Vercel). O corpo aceito é somente `{"eventId":"<provider_event_id da Central>"}`, com autenticação `x-nexus-central-internal-key` em uma requisição privada. Nunca colar o segredo em chat, URL, frontend, repositório ou logs.

**Regras de segurança:** somente eventos existentes em `nexus_payment_webhook_events` que sejam `PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED`; verificação independente via GET da API Sandbox; negar incompatibilidades de documento, valor, método, assinatura, status ou referência. A resposta é informativa (`verified_for_review` ou `manual_review`) com `canActivateCrm:false`. A função não pode executar a reserva ou claim mesmo que as flags financeiras sejam ativadas indevidamente.

**Ponto de aprovação:** validar o resultado para a cobrança já recebida. Apenas em uma **segunda fase**, com autorização de commit/build/deploy, reavaliar reserva idempotente, movimento para `paid` e provisionamento de conta fictícia. Nenhum cliente, cortesia ou cobrança real deve ser modificado.

**Publicação:** alterações no backend Nexus Central seguem branch de trabalho e PR/CI; a Edge Function publicada no Supabase é independente do checkpoint Vercel do Nexus CRM. Não publicar automaticamente. O CRM continua usando sua regra de deploy e o checkpoint manual de `docs/PRODUCTION_DOMAIN_MAP.md` quando tiver código do próprio CRM para publicar.
