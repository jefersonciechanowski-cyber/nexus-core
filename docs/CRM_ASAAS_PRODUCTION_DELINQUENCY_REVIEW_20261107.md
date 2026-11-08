# Nexus CRM — política comercial aprovada de inadimplência (execução ainda bloqueada)

Data: 07/11/2026. Status: **política aprovada pelo responsável comercial**.
A execução de avisos e suspensões automáticas **não foi ativada**. Nenhum
depósito, cobrança, suspensão, alteração de assinatura ou mensagem
será gerado por esta implementação.

## Princípios

1. Uma notificação `PAYMENT_OVERDUE` do Asaas **não comprova sozinha**
   inadimplência atual. Consultar novamente pagamento, assinatura e
   titular no Asaas, conferir CPF/CNPJ, valor, produto, empresa e
   assinatura do CRM em produção.
2. **Carência aprovada de 7 dias corridos**, contados da data de vencimento
   da cobrança, no calendário de São Paulo. Durante esse período,
   **não suspender** o cliente por inadimplência.
3. Após a carência, um pagamento ainda `OVERDUE` e uma assinatura
   `ACTIVE` produzem apenas `candidate_review`, com a política
   agora aprovada. Requer avaliação e decisão administrativa individual. Não executam suspensão automaticamente.
4. Um pagamento já `RECEIVED` ou `CONFIRMED` bloqueia qualquer
   suspensão; encaminhar para o worker idempotente de renovação.
5. `PAYMENT_REFUNDED`, `SUBSCRIPTION_DELETED`, chargebacks, assinaturas
   inativas ou dados inconsistentes exigem revisão humana.
   Cancelamento terminal não deve ser revertido automaticamente.
6. A sincronização do CRM deve ocorrer somente após alteração
   financeira autorizada e registrada, com confirmação de revisão
   pelo serviço de entitlement. Nunca cortar acesso só com um webhook.
7. Todo evento precisa ser idempotente, sobreviver a atrasos e replays,
   e permanecer isolado por empresa, produto, contrato e provedor.

## O que esta PR entrega

- Módulo puro `crm-asaas-production-delinquency.mjs` com esses controles;
- verificação de carência, relógio, eventos fora de ordem, documentações
  divergentes, reembolso, resolução da dívida, empresa e assinatura;
- integração **somente leitura** à prévia de ciclo de vida existente
  `nexus-crm-asaas-production-lifecycle-preview`, que continua
  **HARD OFF** no backend;
- testes CI que garantem `canSuspendCrm:false` e
  `canChargeCustomer:false`, incluindo após os 7 dias.

## Não está liberado

A carência de sete dias foi **aprovada pelo responsável comercial em
07/11/2026**. A política estabelece que um aviso de atraso deverá ser
encaminhado ao cliente antes de qualquer suspensão, com idempotência,
comprovação de entrega quando disponível e nenhuma comunicação repetida
indevidamente. O aviso automático ainda precisa de implementação,
validação de destinatário e homologação de envio.

Ao completar sete dias corridos, o sistema poderá recomendar **análise
administrativa**, mas não suspenderá o CRM automaticamente. Antes de uma
eventual suspensão, o operador deverá reconfirmar em tempo real a ausência
de pagamento, o titular, a assinatura, as notificações e a situação
contratual. Pagamentos confirmados reativam o mesmo acesso somente após
registro financeiro idempotente e sincronização confirmada com o CRM.
Estorno, chargeback e cancelamento exigem revisão específica, não bloqueio
ou reativação automáticos.
A versão desta PR não possui função de suspensão, e não habilita
checkout, workers de cobrança, webhooks financeiros automáticos,
envio de e-mail ou criação de tenant.

## Evidência operacional pendente

A conta Asaas possui webhook CRM configurado e habilitado, porém
até a verificação de 07/11/2026 não havia mensagens nos Logs do
Asaas nem eventos na tabela `nexus_crm_asaas_production_events`.
Essa ausência é **inconclusiva**, não constitui teste de entrega.
Somente um evento autêntico da conta Asaas, devidamente identificado
e gravado com resposta HTTP 200, comprovará integração real.

Sem novos depósitos do operador; a primeira cobrança legítima de
cliente pode ser acompanhada em rollout controlado após aprovação
dos gates restantes, mas não representa teste prévio de renovação.
