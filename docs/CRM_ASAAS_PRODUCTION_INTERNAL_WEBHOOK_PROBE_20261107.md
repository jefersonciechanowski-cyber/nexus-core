# Nexus CRM — prova interna do receptor Asaas sem Pix

Data: 07/11/2026. A configuração do webhook exclusivo do CRM na
conta Asaas de produção já está habilitada com os sete eventos
esperados. Até a inspeção de logs do usuário, não havia entregas
registradas nas categorias Cobranças e Assinaturas.

## Para que serve

- O botão privado **Testar conexão interna do webhook** na Nexus Central
  requer login Nexus Admin ativo + MFA2.
- O administrador chama o endpoint de diagnóstico, que usa o token
  exclusivo `NEXUS_CRM_ASAAS_PROD_EVENTS_TOKEN` apenas no backend e
  faz um GET interno autenticado ao receptor de eventos.
- O receptor exige os dois gates de recebimento, valida o token
  usando comparação segura e tenta LER a tabela RLS
  `nexus_crm_asaas_production_events` via `service_role`.
- Retorna `internal_token_and_inbox_ok` somente se a autenticação
  e a leitura do banco forem concluídas.
- A chamada NÃO cria evento financeiro sintético, webhook, link Pix,
  assinatura, cobrança, cliente, tenant, e-mail ou pagamento.
- O checkout, o provisionamento, a renovação e o motor de suspensão
  continuam com bloqueios independentes.

## Limitação

O teste interno **não é uma notificação originada pelo Asaas**.
Mesmo aprovado, a entrega real de `PAYMENT_RECEIVED` ou
`SUBSCRIPTION_UPDATED` exige checar o log do Asaas com HTTP 200
e a gravação do respectivo `provider_event_id` no banco. Não é
seguro declarar go-live 100% antes da homologação do fluxo da
primeira contratação real e do controle de carência.

## Segurança

Nunca mostrar ou copiar o token em mensagens, screenshots ou frontend.
Não alterar segredos do SST Controle. Se o probe retornar 401,
verificar igualdade das credenciais armazenadas entre o Asaas e a
Nexus Central sem revelá-las; se 503, revisar as flags e o RLS/serviço.
Não gerar nova cobrança como solução de diagnóstico.
