# Nexus CRM — preparação comercial (30/10/2026)

**Conta:** Nexus Central, GitHub `jefersonciechanowski-cyber/nexus-core`.
**Branch:** `feat/crm-commercialization-gates-20261030`.
**Meta:** abrir as vendas na semana de 02/11/2026, **somente após** aceitação financeira/contratual e aprovação do operador.
**Publicação agora:** nenhuma. CRM Vercel (`nexuscoreindustria-create/nexus-crm`) intocado, incluindo `deploy/meta-account-scope-production`.

## O que foi preparado neste pacote

1. Um portão de liberação de **teste grátis administrativo**. A concessão de 15/30 dias e o vencimento exigem aprovação específica, modo `pilot` e confirmação operacional do mecanismo de expiração, além das flags próprias. Sem configurar TODAS as flags, os dois endpoints retornam 503 antes de tocar clientes ou bancos.
2. Um agendamento GitHub Actions diário de expiração de teste, opt-in e desativado por padrão; usa token de identidade OIDC efêmero, **sem senha estática**. O worker existente só aceita audiência `nexus-crm-trial-reconcile`, repositório Nexus Central, branch main e evento schedule/workflow_dispatch. Usa a RPC de expiração idempotente já existente, com entrega de entitlement ao CRM.
3. Um relatório automático no CI, `node scripts/crm-commercial-readiness.mjs`, que lista impeditivos de go-live e NUNCA confunde testes Sandbox com pagamentos reais. Um CI verde valida segurança e código, **não** é autorização para faturar ou liberar acesso.
4. Testes offline das flags, da ordem dos bloqueios, da identidade do workflow, da prevenção de venda duplicada e do status de lançamento.

## Gate de teste grátis — habilitação futura, não neste commit

Deixar todos os controles abaixo desligados até homologação em uma conta piloto autorizada:

- `NEXUS_CRM_TRIAL_RELEASE_APPROVED=true`
- `NEXUS_CRM_TRIAL_RELEASE_MODE=pilot`
- `NEXUS_CRM_TRIAL_EXPIRY_SCHEDULE_CONFIRMED=true` (somente após executar e conferir o job de expiração e a entrega do entitlement)
- `NEXUS_CRM_TRIAL_RECONCILE_ENABLED=true`
- `NEXUS_CRM_TRIAL_GRANTS_ENABLED=true` (concessão por administração Nexus com MFA2, não pelo navegador público)
- GitHub repository variable `NEXUS_CRM_TRIAL_EXPIRY_WORKFLOW_ENABLED=true` (agenda programada, gate independente)

Essas chaves **não são ativadas neste pacote**. A rotina de expiração NÃO cria cobranças, não exclui dados e não altera cortesias existentes. O período do teste termina sem conversão automática para pagamento.

## Bloqueios reais para vender o CRM

| Fluxo | Situação em 30/10/2026 | Critério de aceite |
|---|---|---|
| Assinatura Pix/Boleto mensal em conta Asaas real | Endpoint atual aceita **somente** empresa fictícia `Nexus CRM Sandbox E2E` e modo `sandbox` | Separar produção da Sandbox com credencial, webhook e conciliação próprios; conferir link e recorrência mensal, valor do plano e ausência de cobrança anual |
| Reconciliação de pagamento real | Verificador e claim bancário atuais são **sandbox-only**; pagamento fictício recebeu divergência documental, apropriadamente bloqueada | Pagamento real de cliente consentido, valor correto, documento e assinatura consistentes; autorização específica para testar cobrança real |
| Provisionamento automático | `STAGED_ASAAS_DISABLED = true` e serviço somente Sandbox | Uma única entrega do CRM após pagamento conciliado, com teste de reentrega segura, anti-duplicação e acesso de fato utilizável |
| Trial 15/30 dias | Código administrativo preparado, gated, não publicado/ativado nesta PR | Homologar concessão com MFA2, uso, término e suspensão com entrega ao CRM; não permitir segunda concessão à mesma identidade |
| Conversão trial → pago | Checkout público atualmente **rejeita empresas existentes**, inclusive quem abriu trial, para impedir contrato paralelo | Criar fluxo autenticado para **a mesma empresa e o mesmo tenant**, sem duplicação de usuário, preservando dados e cortesia |
| Recorrência e cancelamento | Prévia somente leitura publicada; transição real é restrita | Comprovar renovação, pagamento em atraso, estorno, cancelamento, relógio de eventos e política de carência antes de suspender |
| Abertura do site | Landing e CRM Vercel fora do escopo desta PR | Teste completo de checkout, e-mail, onboarding e suporte, com plano e preço mostrados ao cliente iguais à cobrança |

Asaas: `chargeType=RECURRENT`, `subscriptionCycle=MONTHLY`. Para Pix e boleto, a recorrência **gera cobranças periódicas; não significa débito automático garantido**, ao contrário de cobrança automática em certos cartões. Os webhooks devem ser a fonte principal de atualização, com consulta autenticada quando necessário.
Referência: https://docs.asaas.com/docs/criando-um-link-de-pagamentos e https://docs.asaas.com/docs/criando-uma-assinatura

## Próximo lote após CI

Priorizar **conversão trial → assinatura na mesma organização** e arquitetura segregada Asaas live + webhook, antes de acionar cobrança de clientes. Não marcar 100% nem publicar o CRM comercial enquanto os bloqueios do relatório persistirem. Cada commit/build/merge/deploy segue a autorização e a regra do usuário.
