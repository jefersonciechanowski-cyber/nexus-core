# Central Nexus — prova de backup externo cifrado e continuidade

Data da validação: **22/11/2026 UTC**.

## Resultado com evidência de leitura do segundo provedor

- Fonte: GitHub Actions, workflow `central-real-restore-drill.yml`, [run 44924143771](https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44924143771), artefato `central-validated-encrypted-backup-44924143771`, id `14715062101`.
- Destino externo: **pasta privada no Google Drive**, conta separada de acesso; por segurança, o endereço e o identificador da pasta não são publicados no repositório.
- Nome do arquivo externo: `central-validated-encrypted-backup-44924143771.zip`.
- Tamanho do ZIP no GitHub e na leitura de volta do Drive: **2.575.342 bytes**.
- **SHA-256 ZIP fonte e Drive: `49d42ed9b8063225939fb50b90115ced79df817c52740efbdfe63d50859e0663`**. Releitura binária do ZIP no Drive e SHA-256 computado independentemente no ambiente de análise, igual ao digest GitHub.
- O ZIP contém **somente** `central-verified-44924143771.tar.gz.gpg` e seu `.sha256`, não dados em texto puro. SHA-256 do conteúdo cifrado: `3214f447c969f3dd142651c1be27148a704ddb9eaecc905b39725afffcc9ff47`; checksum coincide com o manifesto incluído.
- Metadados de compartilhamento Google Drive indicam `shared=false` e apenas permissão `owner`, sem acesso anônimo ou domínio.
- A recuperação de **3/3 objetos privados reais (2.378.927 bytes)** pela API Supabase local já foi aprovada em [run 44966078715](https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44966078715). Não confundir o volume dos objetos descompactados com o tamanho do ZIP cifrado.

## Continuidade das cópias

- Fonte gera backup cifrado diariamente às **07:30 UTC**, sujeito ao sucesso do workflow e à disponibilidade dos serviços.
- A cópia externa é monitorada por **tarefa independente no ChatGPT**, agendada diariamente **08:30 America/Sao_Paulo** (após o workflow). Ela tenta copiar apenas novo backup cifrado, compara bytes/permissões e informa falhas. **A primeira execução automática ainda não foi observada; não alegar sincronização contínua homologada antes de uma execução bem-sucedida.**
- Não remover versões antigas sem política de retenção aprovada. Se GitHub Actions ou Drive perderem autorização, tratar como falha e não assumir que a cópia foi criada.

## Controles indispensáveis ainda pendentes

1. **Cofre independente:** a senha GPG usada pelo workflow está configurada como segredo do GitHub, mas a recuperação dessa senha em cofre seguro **fora do GitHub ainda NÃO foi comprovada**. O operador deve manter uma cópia em gerenciador de senhas com MFA ou meio offline controlado; não guardar senha junto ao arquivo cifrado. A senha nunca deve entrar em issue, PR, Drive, chat, logs ou CI.
2. **RTO/RPO integral:** os tempos de restauração de PostgreSQL e Storage em laboratório não são medição do tempo para recuperar a aplicação completa; a idade do snapshot não é o RPO garantido. Testar a aplicação em ambiente realmente isolado, inclusive Auth, APIs, Edge Functions essenciais, integrações simuladas e DNS de teste, depois de definir e obter aceite das metas.
3. **Custo e isolamento:** nenhuma conta/projeto Supabase em produção deve ser destino de recuperação. Não criar projeto hospedado sem organização de destino escolhida pelo titular e custo confirmado.
4. **Testes externos:** manter Asaas em sandbox/stub sem cobranças, SMTP em sink sem mensagens reais e DNS de teste sem trocar o domínio produtivo.

## Estado formal da homologação

**17/18 (94,4%)** após conexão verificada do Google Search Console e êxito da segunda cópia cifrada do banco e Storage. **O 18º critério não está aprovado.** A prova da segunda cópia resolve parte importante do DR, mas não substitui a recuperação integral hospedada, credenciais independentes e RTO/RPO de serviço.

**Nenhuma afirmação neste documento constitui SLA ou garantia de segurança total.**
