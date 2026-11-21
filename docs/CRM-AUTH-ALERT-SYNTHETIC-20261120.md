# Nexus CRM — ensaio sintético de alertas de autenticação

Verificação em **20/11/2026**, horário de Brasília. O fluxo de monitoramento permanece **ativo** e usa contagens agregadas das rotas `/auth/v1/token`, `/auth/v1/recover`, `/auth/v1/verify` nos logs de borda do CRM, na janela UTC anterior de 60 minutos.

**Gatilhos por rota**: três respostas HTTP 429, **OU** 20 respostas 400/401/403/422.

## Evidência de execução agendada

- Foi criado um ensaio único **sem alterar o prompt da automação real** e sem inserir registros nos bancos dos clientes.
- A execução foi registrada como `completed` por volta de **20/11/2026 22h48 (Brasília)**.
- Conteúdo emitido: **TESTE SINTÉTICO — NÃO É INCIDENTE REAL**; rota `/auth/v1/token`; **3 HTTP 429 fictícios**; zero recusas fictícias; indicação expressa de que nenhum evento de ataque ocorreu.
- O agendador registrou uma saída do tipo `chatgpt` vinculada à execução. A tarefa de teste terminou automaticamente e foi desabilitada.
- A automação real permaneceu habilitada e sua execução avulsa leu logs reais, sem encontrar gatilhos na janela verificada.
- A API disponibilizou o resultado escrito da tarefa; o campo `delivery_status` não confirma entrega de *push* em dispositivo. **Não registrar recebimento físico/visual como comprovado sem sinal independente.**

## Prova reproduzível da regra

`node --test tests/crm-auth-alert-synthetic.test.mjs` verifica separação por rota, gatilhos, casos abaixo dos limites, exclusão de rotas não monitoradas e relatório somente agregado. São dados fictícios, sem senhas, e-mails, IPs ou tokens.

## Segurança

O procedimento não tentou senhas, não atingiu endpoints reais, não criou alertas falsos nos logs, não alterou MFA, RLS, Asaas ou contas. O rótulo de teste deve permanecer explícito.

## Distinção importante

O ensaio comprova **geração agendada do aviso e registro de saída ChatGPT**, mas não mede notificações do sistema operacional nem confirma que uma pessoa abriu o aviso. Isso não deve ser confundido com ataque real ou com gatilho real do monitor em produção.
