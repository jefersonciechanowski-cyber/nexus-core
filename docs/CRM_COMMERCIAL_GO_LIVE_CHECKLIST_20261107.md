# Nexus CRM — estado real dos bloqueios de comercialização mensal

Data de análise: 07/11/2026. Proprietário aprovou carência comercial de
**sete dias corridos** em 07/11/2026, com aviso de atraso, revisão
administrativa prévia à suspensão e reativação após pagamento confirmado
e sincronização do mesmo tenant.

## O que pode ser feito sem criar cobranças

- O site `/crm/` informa os planos Start (R$79), Pro (R$119) e
  Gestão (R$159) e agora oferece **solicitar contratação assistida**.
  Essa solicitação abre e-mail ao suporte, não abre API de pagamento.
- O teste real Pix de R$10 já comprovou ativação isolada; não repetir.
- A autenticação e leitura da fila de webhooks foram comprovadas pelo
  diagnóstico privado. Os logs do Asaas e o banco não mostravam uma
  entrega originada do provedor.
- O receptor Asaas produção está autorizado somente a persistir eventos
  autenticados. Não executa efeito financeiro.
- A política aprovada de sete dias retorna recomendação de
  `candidate_review` após carência, **nunca suspensão automática**.

## Bloqueios de produção restantes

1. O backend mensal Asaas de produção
   `nexus-public-crm-monthly-asaas-production` mantém um gate
   incondicional `STAGED_ASAAS_PRODUCTION_CHECKOUT_DISABLED = true`.
   Verificador, provisionador, renovador e análise de ciclo mantêm gates
   independentes; nenhuma alteração nesta entrega os remove.
2. Os planos `start`, `pro` e `gestao` no Supabase Central estavam
   `public_visible=false` na verificação de 07/11/2026.
   Não mudar sem autorização de abertura comercial.
3. A página pública `/crm/` antes desta entrega só oferecia pedido
   de demonstração; ainda não existe um checkout mensal conectado,
   autorizado e completo na página. O endpoint de pagamento exige uma
   assinatura HMAC de um serviço intermediário que não pode morar
   no JavaScript público. Não expor o segredo no frontend.
4. É necessário um dispatcher de eventos autenticado e monitorado:
   **inbox -> comprovação no Asaas -> reserva/lease idempotente ->
   provisionamento ou renovação -> e-mail -> sincronização CRM -> auditoria**.
   A existência de workers bloqueados não prova que esta cadeia execute.
5. A primeira entrega autêntica `HTTP 200` do Asaas precisa ser
   reconciliada com o ID armazenado; o teste interno de token não
   equivale a uma entrega do provedor.
6. A primeira venda real de um cliente voluntário deve provar
   separação por empresa, confirmação de pagamento, e-mail,
   liberação automática e acesso à mesma conta. Não exigir outra
   transferência do proprietário.
7. Notificações padrão do Asaas (inclusive vencimento, atraso,
   SMS e voz) podem gerar tarifas por canal. O link mensal está
   configurado com `notificationEnabled:true`, o que cria
   notificações padrão para clientes do link. Antes de abertura
   comercial, validar custos, configurações de canais e evitar
   notificações duplicadas do CRM. Não ativar avisos adicionais
   sem consentimento e estimativa de despesas.

## Critério para declarar 100%

Exigir provas e não só percentual de tarefas: checkout público
autorizado com preços corretos e segredo protegido; webhook real
com `HTTP 200`; fatura recebida e conferida na API produção;
recibo idempotente; usuário e tenant corretos no CRM; e-mail de
primeiro acesso; retomada após falha; faturamento mensal e aviso
de atraso; política de carência e reativação preservadas.
Checar que os produtos SST Controle e Agency não sofreram efeitos.

Até lá, NÃO anunciar o checkout mensal automático como disponível,
nem liberar chaves financeiras, alterar contrato ou criar Pix.

Referências:
- https://docs.asaas.com/docs/receba-eventos-do-asaas-no-seu-endpoint-de-webhook
- https://docs.asaas.com/docs/notificacoes-padroes
- https://docs.asaas.com/docs/notificacoes
