# Central — evidências e critérios de homologação DR (21/11/2026)

## Definição do escopo

Este documento separa **restauração lógica de dados da Central** de **retomada operacional integral**. Não usar `17/18` ou `100%` antes da aprovação dos requisitos ainda não comprovados.

**Ambiente de produção:** Supabase Central (ref `svphwbccqeoakpmcpvhy`). Todas as operações de `pg_dump` na origem são de leitura. Os testes restauram apenas em PostgreSQL 17 efêmero com `--network none`. Sem pagamentos reais, notificações, Auth externos ou alterações no banco de produção.

## Evidências comprovadas (GitHub Actions)

| Controle | Evidência | Estado |
| --- | --- | --- |
| Dump real e restauração lógica em PostgreSQL isolado | [Run 44914215170](https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44914215170) | PASS |
| Proprietários, GRANTs explícitos (inclusive sequência), funções e RLS equivalentes | [Run 44914917295](https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44914917295) | PASS |
| 20 indicadores operacionais coerentes (integridade e estados) | [Run 44914215170](https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44914215170) | PASS |
| Download de artefato armazenado, hash, decifragem e restauração sem origem | [Run 44915040480](https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44915040480) | PASS |
| JWT fictício sem autorização não vê organizações | [Run 44915040480](https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44915040480) | PASS |
| RLS positivo do org_admin real e vínculos de billing sem cobrança | [Run 44919490775](https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44919490775) | PASS |
| Login com serviço real de Auth, cobrança Asaas e retomada pública dos serviços | Não exercitados pelo backup lógico | PENDENTE |

### Medições, limitações e objetivos

- Ensaio isolado sem rede: **77 s** na execução 44914215170; recuperação do artefato armazenado: **14 s** na execução 44915040480. São tempos de laboratório do banco, não tempo de indisponibilidade de produção.
- O segundo ensaio registrou idade de snapshot **1 minuto**. Não implica garantia de `RPO=1 min`.
- Rotina programada de backup: diariamente **07:30 UTC**, sujeita a execução bem-sucedida; janela nominal entre snapshots de 24h. Falhas podem ampliá-la.
- RPO de serviço, RTO de serviço, procedimentos de decisão, responsáveis, acesso ao cofre externo e tempo de reconstrução dos provedores **não estão homologados**. Não atribuir SLA sem medições reais do processo completo.

## Lacunas de recuperação fora do PostgreSQL

Auditoria somente leitura do Supabase em 21/11/2026:

| Componente | Inventário | Situação |
| --- | ---: | --- |
| Storage buckets | 1 bucket **privado** | Metadados no backup; bytes fora |
| Storage objects | 3 objetos privados, 2.378.927 bytes | **PASS**: exportação cifrada e recuperação independente dos bytes/hashes, runs 44924143771 e 44924319356 |
| Edge Functions | 66 implantadas, 66 fontes na `main` | Inclui endpoint novo OIDC de backup, com leitura restrita a um bucket; oito endpoints antigos permanecem desativados (HTTP 410) |
| Auth e integrações | 5 usuários internos no dump; provedores, chaves, SMTP, DNS, Asaas externos | Dados internos preservados; configurações e segredos externos não restaurados |

O bucket continua privado. A exportação cifrada autenticada por GitHub OIDC e o teste de recuperação independente de todos os bytes foram aprovados. **Não existem URLs públicas de documentos**. Ainda falta testar a reimportação desses bytes por API para um serviço Storage Supabase novo, com RLS e acesso da aplicação.

Funções que estavam implantadas sem fonte em `supabase/functions/<slug>/index.ts` na `main` antes desta correção (todas atualmente desativadas por HTTP 410, sem chamar provedores externos): `nexus-part1-billing-acceptance`, `nexus-part3-ordering-acceptance`, `nexus-crm-stripe-test-webhook`, `nexus-crm-billing-acceptance-step`, `nexus-crm-billing-acceptance-run`, `nexus-crm-entitlement-diagnostic-once`, `nexus-public-crm-sales-test`, `nexus-crm-billing-acceptance-once`. As oito versões implantadas foram verificadas como stubs de desativação sem segredos e adicionadas ao repositório. Não reativá-las em novos deploys. O código fonte versionado não substitui um teste de redeploy com configuração de Auth, Storage e fornecedores externos.

## Aceite do critério 17 — requisitos restantes

- [x] Backup e restauração com dados reais, integridade relacional, autenticação armazenada, ACL/RLS e funções restauradas
- [x] Recarga do artefato **criptografado já armazenado** e recuperação independente da base original
- [x] Negativa RLS para usuário fictício sem vínculo
- [x] Testes positivos e negativos de um **membro de organização real, somente no banco restaurado**, e consistência funcional de pagamento/contrato sem cobranças — [run 44919490775](https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44919490775), PASS
- [x] Backup de arquivos privados e recuperação independente dos bytes com hashes SHA-256 e metadados — [run real 44924143771](https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44924143771) + [run offline 44924319356](https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44924319356)
- [x] Fonte das 8 Edge Functions temporárias resgatada do Supabase e versionada com resposta HTTP 410; continua pendente teste da implantação integral de funções essenciais e seus segredos
- [ ] Plano de restauração externo (Auth, SMTP, DNS, Asaas, secrets) com responsabilidades e evidência funcional
- [ ] RTO/RPO de **serviço completo** medidos e aceitos, com cópia independente do GitHub ou risco formalmente aceito

Mesmo com a confirmação do GitHub Actions como `success`, **não aprovar automaticamente o critério 17** se essas pendências continuarem.

## Critério 18 — Google Search Console

Em 21/11/2026 o OpenSEO ainda não possui conta Google Search Console conectada nos projetos Nexus CRM ou Nexus Core. A autorização Google depende da ação explícita do responsável na interface de OAuth. Não marcar o último critério como concluído até confirmar a propriedade correspondente no OpenSEO.

Link para conectar: https://app.openseo.so/p/381654de-eb74-4c9c-89f5-1d3c469a4988/search-performance

## Controle automático de frescor e disponibilidade

O workflow `.github/workflows/central-backup-freshness.yml` verifica diariamente, às 12:00 UTC, os registros de execução da rotina de backup, sua recuperação independente e a existência do artefato criptografado não expirado. Se algum requisito estiver ausente, inconsistente ou com mais de **27 horas**, o GitHub Actions ficará marcado como **failure**. Trata-se de uma verificação de metadados, sem ler o banco nem decifrar arquivos; ela não é uma garantia contratual de RPO, mas ajuda a detectar interrupções da rotina.

A autenticação com provedor externo, cobrança real e os bytes de Storage continuam fora do aceite, apesar do sucesso dos testes do PostgreSQL isolado. O monitor deve continuar ativo mesmo enquanto existirem essas pendências.


## Implementação adicional: exportação privada de objetos com GitHub OIDC

O workflow real passa a solicitar ao próprio GitHub um JWT temporário (*OpenID Connect*) com audiência exclusiva `https://svphwbccqeoakpmcpvhy.supabase.co/functions/v1/nexus-central-storage-backup`. A função interna só atende a JWTs com assinatura RS256 verificável no JWKS oficial, `issuer`, `audience`, ID imutável do repositório, `ref` e `workflow_ref` exatos da `main`, além de validade e evento restrito; `sub` é exigido mas aceita o formato customizável do GitHub. Não confundir `verify_jwt=false` da plataforma com ausência de autenticação: esta rota **exige assinatura Github validada no próprio código** e rejeita usuários anônimos.

O endpoint restringe a leitura ao bucket privado `sst-documents` e à operação `GET` de objetos. A chave privilegiada de Supabase é usada **somente dentro do ambiente da Edge Function**, nunca fornecida ao GitHub. URLs públicas ou links assinados de objetos não são gerados.

As cópias baixadas no runner recebem nomes opacos, hash SHA-256 individual e manifesto de tamanhos e metadados. Todos os bytes são incorporados ao mesmo `tar.gz.gpg` AES-256 do banco, depois de conferir estabilidade de metadata e correspondência com a cópia PostgreSQL isolada. O recovery workflow verifica cada byte, hash e metadado **sem acesso à produção**, aceitando apenas nomes rígidos de membros do pacote.

**Atenção:** restaurar os bytes em arquivos locais de laboratório é diferente de executar um teste de *reupload* em novo Storage da Supabase. Ainda precisa de validação de acesso pela aplicação num serviço reconstruído, procedimento seguro de implantação das Edge Functions, segredos externos, responsáveis e RTO/RPO de serviço. Os backups cifrados no GitHub expiram em 30 dias: manter também uma cópia independente do fornecedor faz parte do DR integral. A rotina deve reprovar se arquivo privado ou login OIDC falhar; nunca usar backup apenas do banco como substituto silencioso.

## Resultado do ensaio completo com bytes de Storage — 21/11/2026

| Prova | Evidência | Resultado |
| --- | --- | --- |
| Backup PostgreSQL + 3 documentos privados em um único pacote AES-256 | [Execução 44924143771](https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44924143771) | **PASS** |
| Inventário antes/depois da leitura do Storage e comparação contra o banco restaurado | [Execução 44924143771](https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44924143771) | **PASS** |
| Recuperação independente sem banco de origem, SHA-256 individual de 3/3 arquivos (2.378.927 bytes) e igualdade dos metadados | [Execução 44924319356](https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44924319356) | **PASS** |
| Autorização funcional de membro org-admin da Central, negativa RLS e vínculos financeiros sem cobranças | [Execução 44924319356](https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44924319356) | **PASS** |

- O artefato cifrado `central-validated-encrypted-backup-44924143771` possui **2.575.342 bytes**, expira em **21/12/2026** e inclui dump, manifesto de permissões, metadados e conteúdo dos objetos privados.
- Tempo do ensaio de geração/validação do pacote: **88 segundos**. Tempo do ensaio de recuperação independente offline: **13 segundos**. Esses tempos não são RTO de serviço.
- O teste independente não precisa consultar o banco Supabase de produção: baixa o artefato já armazenado no GitHub, descriptografa com a credencial protegida no próprio GitHub e reconstitui os arquivos temporariamente no runner, verificando SHA-256 e metadados do PostgreSQL restaurado. Nada é enviado como arquivo desprotegido.
- Saúde da Central verificada após os testes: `ACTIVE_HEALTHY`.

### Pendências indispensáveis para recuperação de serviço

1. **Reupload de Storage:** realizar teste isolado de importação por API em um projeto Supabase temporário, verificar acesso com RLS e remover o ambiente de teste. Não editar `storage.objects` via SQL nem reimportar em produção como ensaio.
2. **Autenticação e integrações:** assegurar procedimento de restauração segura de configurações não incluídas no dump (SMTP, DNS, sessões, chaves de Auth, Asaas e serviços externos), com testes sem cobrar clientes.
3. **RTO/RPO:** definir metas de continuidade e medir um incidente simulado cobrindo toda a aplicação, não somente PostgreSQL e Storage em laboratório.
4. **Redundância fora do GitHub:** armazenar cópia cifrada em segundo provedor ou aceitar formalmente o risco de indisponibilidade do GitHub/expiração de artefatos. Garantir recuperação da senha de criptografia em um cofre autorizado **fora do GitHub**, com controle de responsáveis.

**Placar formal permanece em 16/18 (88,9%) enquanto o critério 17 não cumprir o escopo integral.** A conexão Google Search Console (critério 18) ainda depende de autorização explícita do titular da conta Google.

## Atualização complementar de evidências — 22/11/2026

**Integração Storage API local: PASS.** [Execução 44965006913](https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44965006913), [PR #245](https://github.com/jefersonciechanowski-cyber/nexus-core/pull/245). A stack oficial Supabase foi executada em Docker local no GitHub Actions; 3/3 **documentos fictícios** passaram em POST/GET autenticado, SHA-256, negativa de acesso anônimo e proteção sem sobrescrita. A stack foi destruída ao fim. Teste sem qualquer conexão com Central, CRM ou Agency de produção.

A prova local melhora a confiança no método de reimportação, mas não constitui ensaio hospedado de restauração dos **três arquivos reais** nem homologação integral de Auth, Edge Functions, Asaas, SMTP, DNS ou RTO/RPO de serviço. A matriz de dependências externas está em [CENTRAL-DR-EXTERNAL-DEPENDENCIES-2026-11-21.md](CENTRAL-DR-EXTERNAL-DEPENDENCIES-2026-11-21.md), incorporada no [PR #244](https://github.com/jefersonciechanowski-cyber/nexus-core/pull/244).

**Placar formal mantido em 16/18 (88,9%).** Critério 17 exige ensaio integrado e aceite; critério 18 exige OAuth Google Search Console no OpenSEO. Nenhum percentual foi inflado por teste sintético/local.

## Nova evidência — reimportação dos três objetos privados por API local real (22/11/2026 UTC)

[GitHub Actions 44966078715](https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44966078715) — **PASS**. Recuperou o pacote cifrado armazenado da execução 44924143771, verificou SHA-256, decifrou no runner temporário, validou o manifesto e reimportou **3/3 arquivos privados reais (2.378.927 bytes)** na API de Storage de uma instância Supabase local isolada em Docker. Readback autenticado aprovado, acesso anônimo negado, workspace removido. Não houve contratação de projeto hospedado nem escrita nos sistemas de produção.

A prova **supera os testes anteriores com arquivos fictícios**, mas **não** comprova restauração funcional hospedada da aplicação, autenticação completa, recuperação de credenciais/Asaas/SMTP/DNS/Edge Functions, segunda cópia fora do GitHub ou RTO/RPO de serviço. O teste com documentos reais foi limitado a ambiente local de laboratório. O workflow é mantido em execução manual somente na `main` e pinado por SHA.

**Placar geral segue 17/18 (94,4%) após confirmação separada da conexão Google Search Console no OpenSEO**; o único critério restante é a recuperação integral, que exige os aceites adicionais documentados. Não converter resultado de laboratório em garantia contratual.

## Evidência independente — cópia cifrada no Google Drive (22/11/2026 UTC)

Foi confirmada **segunda cópia cifrada fora do GitHub**, com ZIP de **2.575.342 bytes** relido do Drive e SHA-256 completo **igual** ao artefato da origem: `49d42ed9b8063225939fb50b90115ced79df817c52740efbdfe63d50859e0663`. Metadados confirmam acesso privado do proprietário; o ZIP contém somente `.tar.gz.gpg` + checksum. Registro detalhado em [CENTRAL-DR-EXTERNAL-ENCRYPTED-BACKUP-2026-11-22.md](CENTRAL-DR-EXTERNAL-ENCRYPTED-BACKUP-2026-11-22.md).

Tarefa diária de cópia externa criada (primeiro disparo ainda pendente de validação). **Senha GPG recuperável fora do GitHub ainda não verificada**; não incluir qualquer senha em documento. RTO/RPO da aplicação e testes hospedados de Auth/Asaas/SMTP/DNS/funções continuam pendentes. **17/18 — 94,4%**, sem aceite de DR integral.
