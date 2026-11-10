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

## Liberação de produção — controle verificável no banco

O checkout do SST **não é liberado por simples presença da chave**. O banco de produção
`public.nexus_sst_asaas_release_controls` mantém, em linha única `production`,
`checkout_enabled=false` e `reconciliation_enabled=false` até aprovação.

O workflow `.github/workflows/sst-asaas-reconcile.yml` valida sua identidade
por GitHub OIDC no `main` e executa **somente GET de leitura** em
`https://api.asaas.com/v3/paymentLinks?limit=1`, com a chave do Asaas
restrita ao Supabase. A verificação registra apenas datas de sucesso
(`asaas_connection_verified_at`, `webhook_secret_present_at`,
`worker_heartbeat_at`). Não consulta nem imprime credenciais ou dados de pagadores.

O processamento periódico das cobranças começa somente quando
`reconciliation_enabled=true` no banco e os indicadores de saúde estão
válidos. A criação de checkout exige adicionalmente
`checkout_enabled=true`, secret `NEXUS_SST_ASAAS_PROD_EVENTS_TOKEN`
presente, `NEXUS_SST_ASAAS_PROD_WEBHOOK_ENABLED=true` e uma API key de
produção válida. Um problema de saúde fecha a oferta de pagamento
automaticamente, sem apagar dados ou desativar a Minha Central.

A URL do webhook exclusivo permanece:
`https://svphwbccqeoakpmcpvhy.supabase.co/functions/v1/nexus-sst-asaas-events`.
Asaas precisa enviar os eventos no header `asaas-access-token`; o valor
do token não deve aparecer em commits, relatórios ou conversas.

### Escopo efetivo da ativação

- A nova contratação **Asaas SST** vale para **pilotos SST já autenticados** na
  Minha Central, com o mesmo cadastro e todos os registros preservados.
- O fluxo público de primeira assinatura SST que ainda utiliza **Stripe**
  continua separado e não foi convertido neste PR. Não anunciar contratação
  pública SST com Asaas até implementar essa rota.
- Sem um pagamento real autorizado, os testes de segurança, SQL, API somente
  leitura e webhook não comprovam todo o caminho **pagar → webhook legítimo →
  ativar**. O primeiro contrato real exige monitoramento e confirmação do
  evento antes de prometer ativação instantânea ao cliente.
- Piloto gratuito não gera cobrança nem assinatura automaticamente. A
  inadimplência mensal só suspende depois da tolerância de sete dias, sob
  confirmação de cobrança vencida no Asaas. Todos os registros permanecem.
- **Não usar sandbox, não gerar cobrança artificial e não modificar
  clientes existentes.**

