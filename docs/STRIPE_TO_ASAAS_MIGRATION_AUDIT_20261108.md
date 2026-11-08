# Auditoria e migração Stripe → Asaas · Nexus Core
**Data da leitura:** 2026-11-08 · **Escopo:** Nexus Central (CRM e SST) · **Modo:** leitura, sem cobranças, cancelamentos ou alterações contratuais.

## Evidências confirmadas no banco da Nexus Central (não equivalem a consulta direta à conta Stripe)
- **CRM:** 1 contrato marcado `billing_provider=stripe`, `subscription_status=active`, plano Start a R$79, referência reduzida `sub_1UBbYn...`. A assinatura vinculada corresponde exatamente a 1 checkout `environment=sandbox` de 2026-09-03. O mesmo ambiente possui um segundo checkout e dois recibos `paid` Stripe de R$79 (R$158 no total), também relativos ao Sandbox. O último pagamento anotado do contrato ativo foi em **2026-09-03** e o `renews_at` registrado foi **2026-10-22**: status do banco não comprova cobrança vigente em Stripe real.
- **CRM, vendas Stripe de produção:** 2 registros `expired`, 1 `lead`; nenhum `nexus_payment_checkouts` Stripe de produção com `provider_subscription_id`.
- **SST, vendas Stripe de produção:** 2 registros `expired` e 4 `lead`; nenhum acesso SST `billing_provider=stripe` registrado.
- **Outros vínculos:** SST tem um acesso legado `billing_provider=asaas`; CRM tem um pré-pago Asaas de teste. Não modificar esses registros.
- **Webhooks Stripe:** há eventos historicamente processados, mas a última evidência local de `invoice.paid` é de 2026-09-11. Isso NÃO prova que não houve pagamentos depois na plataforma Stripe.

### Limitação crítica
**A conta Stripe não estava conectada diretamente para leitura em 08/11.** O registro 'ativo' observado pertence ao fluxo Sandbox. Não assumir que existe cliente real a migrar ou que não existe nenhum contrato externo fora da Central. Só a API/dashboard Stripe em **modo LIVE** esclarece isso. Nunca expor chaves e dados de cartão.

## Inventário do código e das interfaces
- **Nexus CRM** `app/api/public/crm-checkout/route.ts`: novas contratações atuais por Pix/Boleto em **Asaas Produção**; opção cartão Stripe não está visível no checkout aprovado.
- **Central** `nexus-public-crm-monthly-checkout`: checkout público antigo Stripe, **hard-off** no código (`STAGED_CHECKOUT_DISABLED = true`). Preservar até verificar migração e histórico.
- **Central** `stripe-create-checkout`: checkout autenticado, utilizado por contratos de produtos existentes; **ainda existe e pode criar sessões Stripe**. Não desligar sem verificar suas telas consumidoras e o fluxo substituto SST/CRM no Asaas.
- **Central** `stripe-webhook`, `nexus-billing-reconcile`: precisam permanecer para conciliar assinaturas e eventos legados, mesmo que se desabilite a abertura de novas vendas Stripe.
- **Central** `nexus-public-crm-annual-bf-asaas-production`: oferta anual Black Friday preparada e financeiramente fechada até homologação de verificação de cobrança avulsa e provisionamento pré-pago. Não habilitar como parte da migração.

## Sequência para eliminar Stripe como processador de novas vendas
1. **Auditoria Stripe direta e separada LIVE/TEST:** listar produtos, prices, clientes, assinaturas `active,trialing,past_due,unpaid,incomplete,canceled`, últimas faturas, reembolsos, disputas, créditos, cobrança futura e `current_period_end`. Comparar IDs com Central e identificar órfãos. Evitar registrar PII em logs.
2. **Classificação:** Sandbox histórico (não migrar), produção expirada (arquivar como histórico), produção ativa (migrar em lote individual), créditos/contestações (reconciliação manual).
3. **Fluxo substituto Asaas:** criar ou reutilizar cliente por identidade validada; no caso de pagamento mensal usar assinatura Asaas com novo consentimento e método autorizado. Cobranças Pix/Boleto são geradas e pagas separadamente; cartão exige nova autorização e capacidade do Asaas em produção.
4. **Sem cobrança em duplicidade:** conferir a última competência paga no Stripe, definir a primeira data de vencimento Asaas **posterior** ao período já quitado, confirmar link da assinatura Asaas e forma de pagamento. Nunca importar tokens Stripe como se fossem tokens Asaas.
5. **Vínculo no banco em operação de migração atômica/auditada:** preservar o MESMO `organization_id`, usuários, tenant CRM, plano e dados; mudar `billing_provider` apenas após reconciliação dos dois provedores e confirmação da nova assinatura; guardar referências dos dois provedores e trilha de auditoria.
6. **Desligar Stripe por cliente:** somente após assinatura Asaas pronta, consentimento registrado e calendário de cobrança validado, programar no Stripe `cancel_at_period_end` se aplicável, preservando as cobranças e reembolsos históricos.
7. **Fechamento global:** desabilitar **somente** abertura de novos checkouts Stripe, mantendo webhooks e reconciliação legada até que os saldos, disputas e assinaturas sejam encerrados e auditados. Verificar SST, CRM e Nexus Central separadamente.

## Critérios obrigatórios antes da execução de qualquer migração
- Confirmar a consulta direta ao Stripe LIVE e não usar os Sandbox como se fossem assinaturas pagantes reais.
- Não cancelar, cobrar, criar assinatura, transferir dados sensíveis, alterar contrato nem desativar webhooks durante a auditoria.
- Não derrubar a única organização CRM registrada como ativa só porque o último evento local é antigo.
- Não habilitar Stripe novamente como opção de checkout público; o fluxo do site CRM segue Asaas.
- Conservar segregação por organização/RLS, recibos, histórico de planos e logs.

**Situação auditada:** inventário da Central concluído; confronto com Stripe LIVE e movimentação financeira pendentes. Conexão Stripe é necessária para declarar o inventário externo completo.
