# Nexus CRM — reserva financeira Asaas Sandbox (etapa separada)

## Estado atual
- O checkout e a assinatura mensal de R$ 79 foram criados no Sandbox em 30/10/2026, e a Central recebeu `PAYMENT_RECEIVED`.
- A verificação autenticada respondeu `manual_review / customer_document_mismatch`: o documento do pagador no Asaas difere do registro fictício da venda. Isso **não equivale a falha de pagamento**, mas impede uma reserva válida.
- O verificador de leitura permanece disponível. Nenhum pagamento, checkout ou cadastro deve ser repetido para o objetivo desta etapa.

## Contrato da nova reserva controlada
No endpoint privado `nexus-crm-asaas-verify-event`, o corpo padrão `{"eventId":"asaas:evt_..."}` mantém **somente leitura**.

Apenas uma chamada explícita de `{"eventId":"asaas:evt_...","reserve":true}` pode pedir a reserva, desde que todas as condições sejam satisfeitas:

1. `NEXUS_CRM_ASAAS_VERIFY_ENABLED=true` e `NEXUS_CRM_ASAAS_MONTHLY_MODE=sandbox`.
2. Header `x-nexus-central-internal-key` autenticado pelo segredo de verificação.
3. `NEXUS_CRM_ASAAS_RESERVATION_ENABLED=true` (novo kill switch, **desligado por padrão**).
4. Header `x-nexus-asaas-reservation-key` autenticado por `NEXUS_CRM_ASAAS_RESERVATION_SECRET`, **novo e diferente** do segredo de verificação, mínimo de 32 caracteres.
5. Comparação em tempo real via GET à API `api-sandbox.asaas.com`: pagamento, payment link, cliente/documento e assinatura; todos devem bater com os registros da Central.

Só depois disso o servidor chama a RPC `reserve_nexus_crm_asaas_verified_payment`, já instalada e restrita a `service_role`. A RPC registra uma reserva idempotente, vinculada por ID de evento, ID de pagamento, venda e assinatura. Ela **não atualiza** `nexus_sales`, não cria usuário e não habilita produto.

## Segurança
- O segredo de verificação apareceu visível em uma captura de tela anterior. **Rotacionar esse segredo antes de considerar habilitar reservas**; a segunda chave independente também não deve ser publicada no frontend ou enviada por chat.
- O endpoint nunca chama `claim_nexus_crm_asaas_provisioning`: a opção `claimEnabled` permanece sempre `false`.
- O worker `nexus-crm-asaas-provision` continua bloqueado com `STAGED_ASAAS_DISABLED = true`; não existe transição automática para `paid` ou `provisioned`.
- A venda fictícia de 30/10 com documento divergente deve continuar em `manual_review`, **sem tentativa de forçar reserva ou alterar CPF/CNPJ retroativamente**.
- Não acionar este endpoint a partir de webhook público. É um mecanismo privado de homologação e futura operação interna, autenticado com dois segredos.

## Publicação futura
Esta PR é preparatória. **Não** modificar `deploy/meta-account-scope-production` do Nexus CRM, nem Vercel, nem Supabase nesta etapa. Merge/deploy exigem uma autorização separada. Validar os testes em CI antes de avaliar a publicação.
