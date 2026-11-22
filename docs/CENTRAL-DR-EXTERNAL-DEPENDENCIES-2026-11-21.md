# Central — plano de continuidade para dependências externas (21/11/2026)

**Estado: plano operacional, não homologação de retomada integral.** Não executar alterações em produção como parte deste documento. Critério formal continua **16/18** até teste integrado e aceite das evidências.

## Pré-condições e contenção

1. Nomear responsável pelo incidente, operador de recuperação e aprovador distintos quando possível. Registrar horário de detecção, último backup cifrado íntegro, ID da execução, SHA-256 do pacote, versão de aplicação e decisão de ativar DR.
2. Priorizar restauração **isolada e sem clientes**; manter envio de mensagens, webhooks, cron, faturamento, e-mails e qualquer processamento de eventos **desabilitados** até autorização explícita. Nunca apontar um clone para APIs produtivas.
3. Credenciais, connection strings, chaves de autenticação, senhas e arquivos privados **nunca** entram em issues, commits, PRs, logs, screenshots ou mensagens. Usar cofre autorizado fora do GitHub e credenciais temporárias por ambiente.
4. Restauração de PostgreSQL, ACLs, RLS e bytes dos três arquivos privados já possui evidência offline. **Não** considerar isso prova de sessão Auth, Storage API, DNS ou cobrança funcionando.

## Matriz de recuperação — responsáveis e provas mínimas

| Dependência | Operador responsável (definir no incidente) | Procedimento seguro | Evidência de aceite | Situação |
| --- | --- | --- | --- | --- |
| PostgreSQL / permissões | DBA / infraestrutura | Recuperar artefato cifrado em ambiente isolado; restaurar dump, sequence ACL, comparar fingerprints e integridade | ID do run; contagens e hashes agregados; negativa/positiva RLS | PASS offline; não é serviço completo |
| Storage privado | Infraestrutura + segurança | Criar destino **descartável**, bucket privado `sst-documents`, conferir bloqueios de projeto de produção; reimportar 3 arquivos por API, readback SHA-256 e testar negativa de acesso não autorizado | ID do destino temporário, 3/3 arquivos, total 2.378.927 bytes, hashes correspondentes, teste de acesso negado, exclusão/revogação | PENDENTE real; teste de API só simulado |
| Supabase Auth | Responsável de identidade | Inventariar configurações de provedores, redirects, chaves e políticas sem exportar segredos; criar identidade fictícia de teste; verificar login, renovação de sessão, isolamento por organização e revogação | Teste positivo e negativo em ambiente descartável; nenhum usuário real impactado | PENDENTE |
| Edge Functions / jobs | Engenharia | Implantar fontes versionadas com variáveis **de teste**; manter 8 funções legadas em HTTP 410; desligar cron, webhooks e automações até verificação e aprovação | Lista de versões implantadas, endpoint controlado, logs sem dados pessoais, ausência de disparos externos | PENDENTE |
| Asaas / pagamento | Financeiro + engenharia | Usar sandbox/stubs e contas fictícias; desabilitar recepção de webhooks de produção, cobranças e reprocessamentos; validar idempotência e reconciliação sem faturamento | Eventos de teste deduplicados; zero cobrança real; autorização explícita antes da virada | PENDENTE |
| SMTP / notificações | Operações + engenharia | Usar caixa de teste ou sink de e-mail; bloquear envios a clientes, validar DNS de autenticação e templates sem mensagens reais | E-mail fictício no sink e negação a destinatário real | PENDENTE |
| DNS / domínio / TLS | Administrador DNS | Preparar registros, TTL, certificados e plano de rollback; **não** trocar apontamentos de produção no ensaio | Resolução e HTTPS em hostname de teste; rollback documentado | PENDENTE |
| Chaves e cofre externo | Segurança / proprietário | Confirmar acesso de recuperação a senhas/segredos em cofre **fora do GitHub** com controle de privilégio, dupla checagem e rotação pós-incidente | Acesso verificado por operador autorizado sem exibir valores; revisão de permissões | PENDENTE |
| Segunda cópia cifrada | Segurança / operações | Copiar `tar.gz.gpg` para provedor independente e controlar retenção; testar recuperação do arquivo e da senha sem depender do GitHub | SHA-256 idêntico e teste de leitura do pacote cifrado; data/expiração | PENDENTE |

## Sequência de homologação sem alterar produção

1. **Gate 0 — autorização:** confirmar projeto temporário já disponível, custo zero ou custo explicitamente aprovado, ausência de dados de clientes e credenciais exclusivas. Não provisionar plano pago automaticamente.
2. **Gate 1 — backup:** escolher artefato cifrado armazenado e comprovar checksum, validade, restauração offline, ACL/RLS e integridade de 3 arquivos.
3. **Gate 2 — Storage:** criar bucket privado no alvo temporário, executar ferramenta de API, verificar 3/3 hashes após download e validar um usuário fictício não autorizado. A chave administrativa não deve ser usada como evidência de RLS.
4. **Gate 3 — aplicação isolada:** recriar Auth de teste e implantar Edge Functions essenciais com integrações externas **simuladas**; desabilitar disparadores, webhooks reais e jobs. Verificar navegação, autorização de empresas, documentos e registros financeiros fictícios.
5. **Gate 4 — integrações:** testar rota de SMTP com sink e pagamentos Asaas em sandbox/stub; preparar procedimento de DNS com hostname de teste. Não cobrar, enviar comunicações nem mudar DNS produtivo.
6. **Gate 5 — continuidade:** medir tempos de cada fase e do serviço íntegro; registrar idade do ponto recuperado, perda de eventos simulada, dependências que exigem suporte externo e riscos aceitos.
7. **Gate 6 — encerramento:** revogar credenciais, remover dados e ambiente descartável, preservar apenas logs agregados sem PII, arquivar evidências e exigir aprovação humana antes de declarar 17/18.

## RTO e RPO — método, não números prometidos

- **RTO medido:** início do incidente simulado até a aplicação **inteiramente funcional** no ambiente de recuperação, incluindo autenticação, Storage, funções, TLS, e integrações simuladas. Registrar início, término, método, dependências não recuperadas e resultado; 13 s de restauração offline não é RTO do serviço.
- **RPO medido:** instante do último dado/evento confirmado que ficou disponível no serviço recuperado versus instante do incidente simulado; testar também eventos que chegaram depois do último snapshot. Intervalo diário nominal de backups não é uma garantia de RPO.
- Definir **metas** de RTO/RPO com titular e impacto operacional **antes** da homologação. Se o ambiente não reproduz serviços reais, rotular métricas como ensaio parcial, sem SLA.
- Para cada dependência externa que não pode ser exercitada sem produção, documentar risco residual, intervenção manual e responsável; não confundir procedimento com prova.

## Registro de evidência (preencher na execução)

| Campo | Valor |
| --- | --- |
| Data/hora UTC, operador e aprovador | PENDENTE |
| Run de backup e restauração offline | 44924143771 / 44924319356 (PASS) |
| Projeto de recuperação isolado / bucket privado | PENDENTE |
| Reimportação por API e readback SHA-256 | PENDENTE |
| Testes Auth/RLS positivos e negativos | PENDENTE |
| Funções essenciais e jobs bloqueados | PENDENTE |
| Testes Asaas sandbox, SMTP sink e DNS não produtivo | PENDENTE |
| Segunda cópia cifrada / cofre fora do GitHub | PENDENTE |
| RTO total e RPO real medidos; metas aprovadas | PENDENTE |
| Revogação e limpeza do ambiente | PENDENTE |
| Aceite formal (operador + aprovador) | PENDENTE |

**Regra de aceite:** apenas a documentação desta matriz não altera o placar 16/18. O 18º critério continua separado: autorização do Google Search Console no OpenSEO pelo titular.

## Atualização de status — 22/11/2026 UTC

Segunda cópia criptografada no Google Drive **aprovada por readback + SHA-256** do ZIP, em pasta privada; ver [prova externa](CENTRAL-DR-EXTERNAL-ENCRYPTED-BACKUP-2026-11-22.md). Três arquivos privados reais reimportados com sucesso por API Storage **local** (run 44966078715). A célula “segunda cópia” da matriz histórica acima passa a **PASS**, mas a de **cofre de chaves independente** continua **PENDENTE**. Automação de cópias externas criada, **ainda sem execução recorrente verificada**. RTO/RPO real de serviço, teste hosted/isolado e dependências externas continuam pendentes. Placar 17/18 (94,4%), não homologar serviço completo.
