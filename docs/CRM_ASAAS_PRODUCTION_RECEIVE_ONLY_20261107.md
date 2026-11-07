# Nexus CRM — Asaas Produção: ativação do webhook em modo somente recebimento

Data: 07/11/2026. **Sem depósitos, cobranças, novo cliente ou alteração de
plano.** O domínio e os endpoints do SST Controle ficam independentes.

## Por que precisamos desse estágio

O diagnóstico privado de produção mostrou `webhook_not_registered`. O
endpoint `nexus-crm-asaas-production-events` devolvia HTTP 503
incondicionalmente. O Asaas considera somente HTTP 200 como confirmação
de entrega, e pausa a fila após falhas repetidas. Não cadastrar webhook ativo
até o receptor estar pronto.

## Contrato de segurança implementado

- O receptor passa a aceitar APENAS armazenamento autenticado quando ambas
  variáveis privadas na **Supabase Central** forem `true`:
  `NEXUS_CRM_ASAAS_PROD_EVENTS_ENABLED` e
  `NEXUS_CRM_ASAAS_PROD_EVENTS_RECEIVE_ONLY_ENABLED`.
- Autenticação obrigatória pelo `asaas-access-token` comparado com
  `NEXUS_CRM_ASAAS_PROD_EVENTS_TOKEN` (chave gerada exclusivamente para esse
  webhook, 32–255 caracteres, sem espaços).
- O segredo não pode reutilizar chave de API Asaas, nem qualquer senha de
  checkout, conciliação, provisionamento ou renovação da Nexus Central.
- O corpo do evento fica limitado a 32 KiB; somente dados financeiros
  minimizados são persistidos na tabela de produção com RLS e ID único.
- Após gravar (ou encontrar evento ID já recebido), responde HTTP 200.
  Se a gravação falhar, responde 503 para permitir reenvio correto.
- NÃO chama banco financeiro, Asaas API, CRM, Auth, Stripe ou Brevo; não
  libera assinatura nem cancela acesso.
- O checkout mensal Asaas, os workers de verificação, provisionamento,
  renovação e inadimplência continuam HARD OFF por controles independentes.
  Esta mudança NÃO declara go-live financeiro.

## Configuração operacional manual, em ordem

1. Acessar `Menu do usuário > Integrações > Webhooks` no **Asaas Produção**.
   Preparar **um webhook exclusivo**:
   - Nome: `Nexus CRM — Mensal Produção`
   - URL:
     `https://svphwbccqeoakpmcpvhy.supabase.co/functions/v1/nexus-crm-asaas-production-events`
   - E-mail de alertas: endereço operacional do administrador
   - Versão de API: v3
   - Token: selecionar **Gerar token**, copiar sem enviar em mensagem/print
   - Eventos: `PAYMENT_CONFIRMED`, `PAYMENT_RECEIVED`,
     `PAYMENT_OVERDUE`, `PAYMENT_REFUNDED`,
     `PAYMENT_CHARGEBACK_REQUESTED`, `SUBSCRIPTION_UPDATED`,
     `SUBSCRIPTION_DELETED`
   - Criar inicialmente desativado, se a interface permitir.
2. Salvar esse MESMO token somente como secret
   `NEXUS_CRM_ASAAS_PROD_EVENTS_TOKEN` no projeto Supabase **Nexus Central**
   `svphwbccqeoakpmcpvhy`. Nunca alterar `ASAAS_PRODUCTION_API_KEY`
   ou tokens de outros produtos.
3. Gravar `NEXUS_CRM_ASAAS_PROD_EVENTS_ENABLED=true` e
   `NEXUS_CRM_ASAAS_PROD_EVENTS_RECEIVE_ONLY_ENABLED=true`.
   Os endpoints já foram publicados, mas essas flags estão desligadas
   por padrão até o administrador inseri-las.
4. Reativar/cadastrar o webhook no Asaas APENAS após secret + flags;
   checar URL, status e cobertura em
   `https://nexuscore.app.br/apps/nexus-admin/crm-live-pix-pilot.html`.
   O diagnóstico sem cobranças deve mostrar
   `receiver_ready_for_delivery_test`, **não** homologação financeira.
5. Validar uma entrega autorizada pela própria interface e pelo
   `Menu do usuário > Integrações > Logs de Webhooks`. O log precisa
   registrar HTTP 200; a tabela `nexus_crm_asaas_production_events` precisa
   conter o evento exatamente uma vez, mesmo se reentregue. Nenhum
   evento sintético deve ser tratado como fatura real ou ativar CRM.
6. Reavaliar separadamente o processamento financeiro e a política de
   inadimplência antes de considerar a comercialização pronta.

## Rollback

Remover ou alterar `NEXUS_CRM_ASAAS_PROD_EVENTS_RECEIVE_ONLY_ENABLED`
para `false` interrompe novas entregas (HTTP 503, com possibilidade de
retentativas Asaas); para evitar fila interrompida, **desativar primeiro
o webhook no Asaas** antes de desligar a recepção, exceto incidente de
segurança. Não desativar checkout/worker como substituto de autenticação.

## Referências atuais

- https://docs.asaas.com/docs/criar-novo-webhook-pela-aplicacao-web
- https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook
- https://docs.asaas.com/docs/fila-pausada
