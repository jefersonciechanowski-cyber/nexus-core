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
- [ ] Criar checkout Asaas SST autenticado, isolado do CRM, com chave/segredos e flags específicas.
- [ ] Criar recebimento, verificação financeira, idempotência, provisionamento e renovação Asaas para SST; sem bypass de RLS ou consulta do cliente apenas por CNPJ.
- [ ] Ajustar portal para chamar o checkout Asaas SST e remover dependência Stripe na conversão do piloto.
- [ ] Validar em ambiente de teste: dia 1/dia 15/dia 16, suspensão, cobrança somente voluntária, pagamento confirmado, retorno, acesso e integridade dos dados.
- [ ] Testar falhas e retries, pagamento duplicado, e-mail existente, CNPJ divergente, limite de funcionários, retorno sem pagamento e 7 dias de tolerância conforme política.
- [ ] Verificar as configurações e o webhook genuíno no ambiente de produção **sem efetuar novas cobranças de teste**; caso a confirmação externa não esteja disponível, manter bloqueio.
- [ ] Aprovar a publicação somente após evidência de ponta a ponta e revisão de segurança.

**Regra de segurança:** esta branch NÃO autoriza religar Stripe, não altera secret keys, não cria cobranças nem modifica clientes existentes. Nenhuma correção do checkout Asaas deve ser anunciada como concluída até que a verificação financeira esteja comprovada.
