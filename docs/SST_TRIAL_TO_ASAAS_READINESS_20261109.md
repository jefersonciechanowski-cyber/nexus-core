# SST Controle: piloto gratuito de 15 dias -> contratação pelo Asaas

Data da revisão: 2026-11-09  
Status: **PILOTO DISPONÍVEL / CONVERSÃO ASAAS BLOQUEADA ATÉ HOMOLOGAÇÃO**  
Escopo: apenas SST Controle; não alterar fluxo do CRM, cobranças existentes ou clientes de cortesia.

## Verificado no código e no banco de produção

- O formulário administrativo e o backend do `nexus-admin-pilot` foram preparados nesta branch para usar **15 dias como padrão**, sem remover a opção administrativa de outros períodos.
- `provision_nexus_pilot` cria uma organização exclusiva, perfil e acesso `trial` com vencimento; os registros operacionais usam a `organization_id`.
- O SST verifica vencimento no `supabase-auth.js`; o portal do cliente exibe "Assinar plano e manter meus dados".
- O fluxo piloto->pago existente em `nexus-public-sales` e `stripe-webhook` reaproveita `organization_id` e `organization_product_access.id`, incluindo as verificações de e-mail, organização e limite de funcionários.
- **Entretanto** o checkout dessa conversão ainda usa Stripe; `asaas-create-checkout` e `asaas-webhook` legados respondem HTTP 410.
- As Edge Functions novas de pagamentos Asaas em produção são especializadas em **CRM** e não podem ser reaproveitadas para SST sem isolamento e homologação.
- No banco, os planos SST Essencial, Profissional e Empresarial estão ativos, mas não há venda SST Asaas provisionada que comprove a conversão automática ponta a ponta.

## Contrato funcional obrigatório

1. Administrador Nexus libera 15 dias sem gerar cobrança nem assinatura Asaas; e-mail de primeiro acesso somente para o usuário autorizado.
2. Durante o teste, registros de funcionários, EPIs, treinamentos, exames, documentos e auditoria pertencem à mesma `organization_id`.
3. No dia do vencimento, acesso operacional é suspenso; **nenhuma rotina exclui dados, usuário ou empresa**. O botão de contratação permanece acessível.
4. Cliente autenticado escolhe plano e inicia contratação **exclusivamente em fluxo Asaas verificado**: nunca pelo cadastro público anônimo que criaria empresa nova.
5. Checkout só pode usar `organization_id` e `access_id` lidos da sessão autenticada e validados no banco (RLS/role); não aceitar IDs arbitrários do navegador. Validar CPF/CNPJ, e-mail e limites comerciais.
6. Evento de pagamento Asaas recebido por webhook autenticado, registrado e deduplicado. Ativar somente após consulta ao próprio Asaas confirmar pagamento, assinatura e vínculo da referência com a mesma empresa.
7. Transição de `trial`/suspenso para `active` reaproveita **a mesma organização, o mesmo acesso e os mesmos usuários**; registros operacionais permanecem íntegros. Registrar auditoria e data de renovação.
8. Pagamento recusado, vencido, callback duplicado ou divergência cadastral: acesso não é liberado indevidamente; manter dados e encaminhar para revisão, sem duplicar assinatura ou cliente.
9. Não iniciar cobrança automaticamente só porque o piloto venceu. Cliente precisa escolher e confirmar o plano.

## Critérios de liberação

- [x] Criar piloto e selecionar 15 dias no painel (padrão ajustado na branch).
- [x] Código de controle de validade e armazenamento por organização.
- [x] Código legado de conversão com preservação da empresa (Stripe).
- [x] Checkout Asaas SST autenticado e separado do CRM, com flags específicas e vínculo ao piloto (somente branch).
- [x] Webhook isolado, prova financeira em consultas GET ao Asaas, ledger com idempotência, conversão atômica, renovação e suspensão após sete dias de vencimento confirmado pelo provedor (somente branch).
- [x] Nova tela autenticada SST e redirecionamento a partir da Minha Central, sem enviar o piloto para a contratação pública Stripe.
- [ ] Homologar com Asaas sandbox/ambiente controlado e navegador: dia 1/dia 15/dia 16, primeiro pagamento, webhook real, retorno, acesso, dados e condições de inadimplência. Testes isolados de SQL e contrato financeiro não substituem essa validação.
- [ ] Concluir teste de integração externa para falhas e retries, pagamento duplicado, e-mail existente, CNPJ divergente, limite de funcionários, retorno sem pagamento e sete dias de tolerância. Cobertura unitária e de SQL já incluída na PR.
- [ ] Configurar webhook exclusivo do SST no painel Asaas, armazenar token em ambiente seguro, validar uma entrega genuína e os dados de produção **sem gerar novas cobranças de teste**; caso não haja evidência externa, manter o checkout fechado.
- [ ] Aprovar a publicação somente após evidência de ponta a ponta e revisão de segurança.

**Regra de segurança:** esta branch NÃO autoriza religar Stripe, não altera secret keys, não cria cobranças nem modifica clientes existentes. Nenhuma correção do checkout Asaas deve ser anunciada como concluída até que a verificação financeira esteja comprovada.

## Liberação de produção (fechada por padrão)

A publicação exige revisar e habilitar em separado `NEXUS_SST_ASAAS_PROD_RELEASE_APPROVED`, `NEXUS_SST_ASAAS_PROD_CHECKOUT_ENABLED`, `NEXUS_SST_ASAAS_PROD_WEBHOOK_ENABLED`, `NEXUS_SST_ASAAS_PROD_RECONCILE_ENABLED`, `NEXUS_SST_ASAAS_PROD_SETTLEMENT_READY` e `NEXUS_SST_ASAAS_PROD_EVENTS_TOKEN` no Supabase, além da variável de workflow `NEXUS_SST_ASAAS_PROD_WORKFLOW_ENABLED` no GitHub. A chave Asaas permanece exclusivamente no backend. **Não colocar valores de segredos em documentação, commits ou conversas.**

URL projetada para webhook (somente depois de implantada a função): `https://svphwbccqeoakpmcpvhy.supabase.co/functions/v1/nexus-sst-asaas-events`. O webhook deve receber eventos de pagamentos e passar token separado em `asaas-access-token`.

O período gratuito não cria cobrança ou assinatura. A inadimplência mensal após contratação exige um boleto/PIX vencido confirmado via GET do Asaas; a rotina admite sete dias de tolerância, preservando os dados ao suspender.
