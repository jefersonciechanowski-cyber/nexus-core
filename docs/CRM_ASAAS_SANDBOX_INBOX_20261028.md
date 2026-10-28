# Asaas Sandbox — inbox de Webhook, sem concessão de acesso

Em 28/10/2026, link manual de teste mensal R$ 5,00 foi pago por simulação Pix no Asaas Sandbox (tela `Recebida`). Esse link MANUAL não é uma venda da Central, portanto não deve criar CRM, assinatura na Central ou alterá-la.

Endpoint ISOLADO: `https://svphwbccqeoakpmcpvhy.supabase.co/functions/v1/nexus-crm-asaas-sandbox-inbox` (POST, sem JWT de Supabase, autenticado obrigatoriamente por token Asaas). Não usar endpoint hard-off `nexus-crm-asaas-monthly-events` para webhook.

Duas variáveis de Edge Function Secrets no projeto Central: `NEXUS_CRM_ASAAS_EVENTS_TEST_TOKEN` com token de 32–255 caracteres diferente da API key Asaas, e `NEXUS_CRM_ASAAS_SANDBOX_INBOX_ENABLED=true`. Sem elas, falha fechado.

Configurar no *Asaas Sandbox* em Integrações → Webhooks: nome `Nexus CRM Sandbox - Eventos`, URL acima, token exatamente igual ao Secret, eventos `PAYMENT_CREATED`, `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`, `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED`, `SUBSCRIPTION_CREATED`, `SUBSCRIPTION_UPDATED`, `SUBSCRIPTION_DELETED`; modelo de envio sequencial, se disponível. Nunca enviar token em chat.

Essa função unicamente persiste evento normalizado e idempotente na tabela `nexus_payment_webhook_events`, não atualiza vendas, pagamentos nem acesso; eventos duplicados recebem 200. Criar webhook DEPOIS da simulação anterior não entrega automaticamente o evento antigo; precisamos de um novo evento de teste ou reenvio suportado, nunca simular pagamento real. Evitar usar email pessoal de terceiros.

Os antigos Asaas checkout, verificador e provisionador permanecem HARD OFF. Antes de comercializar: criar venda pelo checkout assinado, testar renovação, processar conciliação autenticada e assegurar manutenção de tenant. O estágio 04 não é concluído só com evento recebido.
