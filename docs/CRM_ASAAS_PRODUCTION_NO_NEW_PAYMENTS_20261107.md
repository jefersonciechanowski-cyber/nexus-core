# Nexus CRM — Asaas mensal produção, validação sem novos depósitos (07/11/2026)

## Decisão operacional

O usuário não fará novos depósitos ou Pix para homologação. Esta preparação
não solicita novas cobranças, não cria links de pagamento, não modifica
contratos e não habilita o checkout público. O Pix avulso de R$ 10 já está
homologado, mas NÃO prova por si só a assinatura mensal recorrente.

## Implementado

- Módulo puro crm-asaas-production-review.mjs oferece prévia de verificação de
  recebimento mensal e ciclo de vida em produção, exigindo venda CRM recorrente,
  documento e relacionamento entre cobrança, link, cliente e assinatura Asaas,
  preço correspondente, status atual da assinatura ACTIVE e verificações
  independentes dos recursos.
- Reutiliza o validador do Sandbox com environment=production somente quando
  informado explicitamente pelo chamador. Chamadas antigas preservam o padrão
  Sandbox e seguem bloqueando vendas de produção.
- Devolve apenas uma decisão de revisão, nunca aprovação de provisionamento.
  Nenhuma função HTTP ou SQL é chamada pelo módulo.
- Recibos de renovação devem estar na Central e ligados à mesma organização,
  mesmo acesso, valor e assinatura. PAYMENT_OVERDUE não suspende sem política
  de carência; cancelamento e estornos exigem rechecagem independente.

## Próximas barreiras para liberar a venda

1. Implementar endpoint de produção separado para a contratação mensal
   com HMAC, anti-duplicidade e limite por usuário, exclusivamente com
   provedores/URLs credenciados e planos visíveis, inicialmente desligado.
2. Habilitar inbox de webhook Asaas produção, autenticada, idempotente
   e com persistência rápida, sem misturar recursos e eventos Sandbox.
3. Integrar worker exclusivo de produção que use a verificação independente
   antes das transições SQL de reserva, claim e lease, atualmente Sandbox.
   Revisar migrações e isolamento por organização.
4. Homologar entrega de entitlement ao CRM e envio do e-mail já validado;
   testar com fixtures e eventos do Sandbox, sem dinheiro real. Para o go-live
   ainda será necessária aprovação para receber pagamentos reais de clientes,
   diferente de cobrar o próprio operador novamente.
5. Definir carência por inadimplência, vencimento, reativação, reembolso,
   cancelamento e suporte; depois liberar gates um por vez.

## Restrições

- NÃO alterar NEXUS_CRM_ASAAS_MONTHLY_MODE para production no handler Sandbox.
- NÃO habilitar NEXUS_CRM_ASAAS_PREPAID_EXPIRY_ENABLED agora; contrato real
  de R$10 vence em 07/12/2026, sem repetição de cobrança.
- NÃO habilitar checkout Stripe nem fazer deploy de endpoint financeiro sem
  revisão de condições de corrida, idempotência e segurança.
- Este código não marca 100%, nem prova automaticamente o fluxo comercial real.

Referências do Asaas: https://docs.asaas.com/docs/criando-um-link-de-pagamentos
e https://docs.asaas.com/docs/webhooks-2
