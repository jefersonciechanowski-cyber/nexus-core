# Backup da Central pelo GitHub Actions — operação e recuperação

> Escopo: **Central** `nexus-core` / Supabase `svphwbccqeoakpmcpvhy`. Não é o backup diário do `nexus-crm`.

## Situação operacional

O workflow `.github/workflows/central-real-restore-drill.yml` é executado em GitHub Actions na `main`, por agendamento (07:30 UTC) e manualmente. Produz uma cópia PostgreSQL com leitura somente da origem, tenta recuperar num PostgreSQL 17 descartável sem rede e valida um fingerprint de permissões/RLS e indicadores operacionais antes de cifrar e armazenar um artefato por 30 dias.

**Atenção: agendado não significa protegido.** Sem os segredos abaixo, toda execução falha fechada sem produzir backup. A execução PASS do teste sintético não substitui uma restauração real. Verifique o histórico do workflow e o artefato cifrado após configuração.

## Segredos necessários (somente no GitHub)

Abrir a configuração do repositório em `Settings > Secrets and variables > Actions > New repository secret`.

| Nome do segredo | Valor (nunca incluir neste documento) | Fonte / precaução |
| --- | --- | --- |
| `CENTRAL_SOURCE_DATABASE_URL` | URI PostgreSQL completa do Supabase da **Central**, idealmente *Session pooler* | Supabase `Connect > Direct/Connection string > Session pooler`. O trecho `[YOUR-PASSWORD]` precisa ser substituído pela senha real PostgreSQL. |
| `CENTRAL_BACKUP_ENCRYPTION_PASSWORD` | Senha **exclusiva**, gerada num gerenciador seguro, com pelo menos 24 caracteres (preferir 32 aleatórios ou mais) | Necessária para recuperar os artefatos cifrados. Guardar em cofre seguro separado do GitHub e registrar responsáveis/recuperação. |

Não publicar conexão, senha, `.dump`, `.sql`, arquivos de clientes ou artefato decifrado em issues, PRs, conversas, código-fonte, commits ou logs. Nunca usar uma chave `anon` ou `service_role` no lugar da URI PostgreSQL.

Se não souber a senha do banco, **não redefinir de imediato**. Primeiro verificar o gerenciador de senhas e as dependências reais (serviços externos, outros runners e operações administrativas). Uma redefinição pode invalidar conexões existentes. Se necessária, planejar a rotação e atualizar cada dependência de maneira controlada.

## Validação que falta para o critério de recuperação

- Execução real com sucesso após configurar credenciais; registrar link do workflow, data, checksum de *ciphertext*, duração medida e idade do snapshot.
- Provar que funções privilegiadas, proprietários, ACLs, RLS e dados operacionais têm a mesma assinatura na restauração.
- Verificação funcional de autorização entre empresas **sem conectar a restauração a integrações externas**.
- Documentar RTO/RPO reais e o plano de reupload para um novo serviço Storage, além de Edge Functions, DNS, Auth e provedores externos; os bytes dos arquivos já estão no pacote cifrado, mas a aplicação completa ainda não foi reconstruída.
- Confirmar que um administrador autorizado consegue **obter e decifrar** o artefato sem expor segredo ou dados a terceiros.

**Política de aprovação:** não contar este critério como homologado por existir um workflow, pela passagem da CI sintética ou por ter gerado um arquivo criptografado; deve haver evidência de restauração completa e validação funcional.

O repositório é público. O artefato contém dados reais **cifrados**; mantenha a senha de cifragem aleatória, de alta entropia e fora do GitHub, e revise as permissões de acesso ao Actions antes de executar. Repositório privado e armazenamento com retenção mais longa devem ser avaliados antes de usar isto como único mecanismo de recuperação.

O procedimento histórico local consta de `docs/CENTRAL-OFFLINE-RESTORE-DRILL-2026-11-21.md`, mas **não é mais o caminho operacional preferido**. Nenhum PowerShell no computador, Make ou n8n é exigido para o fluxo GitHub.


## Integridade do pacote lógico

O artefato GPG AES-256 validado contém um pacote `tar.gz` que reúne: `central.dump`, `sequence-acl.sql`, `source-integrity.csv`, `security-digest.txt`, `captured-utc.txt`, `source-storage-inventory.json` e a pasta `storage/` com manifesto privado e bytes criptografados dos objetos. Tudo é derivado da origem somente leitura e cifrado num único pacote; o repositório não recebe documentos em claro.

Numa restauração **offline**, aplique o dump ao banco descartável e depois aplique o manifesto de ACL somente nesse ambiente antes de comparar os fingerprints de segurança. O GitHub Actions faz essa verificação e só publica o pacote cifrado após a aprovação. Não execute o manifesto em produção; não divulgue seu conteúdo ou arquivos decifrados.

Este fluxo testa a geração de uma cópia corrente e a recuperação de seus componentes no mesmo ensaio; um desastre real ainda exige recuperar o artefato armazenado, decifrar, restaurar sem depender da origem e validar dependências externas/RTO/RPO.



## Ensaio independente de recuperação do artefato armazenado (GitHub)

O workflow `.github/workflows/central-stored-artifact-restore.yml` roda depois de um backup **real bem-sucedido**, pode ser acionado manualmente e tem agendamento semanal. Ele baixa o pacote criptografado já guardado no GitHub, confere SHA-256, decifra em diretório temporário do runner, aceita exclusivamente os membros esperados do pacote, restaura em PostgreSQL 17 sem rede, reaplica ACLs das sequências e valida segurança e métricas. Reconstrói cada objeto privado do Storage e compara SHA-256, quantidade, tamanho e metadados com o banco restaurado, sem conexão com a Central original. Exige negativa RLS para um usuário fictício sem vínculo e prova funcional de um org-admin real no banco isolado.

O ensaio de armazenamento não recebe `CENTRAL_SOURCE_DATABASE_URL`: valida de forma independente a capacidade de restaurar os dados salvos **sem conexão à Central original**. Ele depende apenas da senha de criptografia guardada no GitHub e da disponibilidade do artefato, que expira após 30 dias. Os logs incluem somente tempos, status e resultados agregados.

### Limites e exigências de desastre real

Esse ensaio **já demonstra a recuperação dos bytes privados do Storage** no ambiente isolado (ver execuções 44924143771 e 44924319356), mas não a reimportação via API num novo serviço Storage Supabase. SMTP, DNS, provedores de Auth, Edge Functions, segredos externos e outras dependências exigem plano e validação próprios. A duração do ensaio não é automaticamente o RTO num incidente, e a idade do snapshot não comprova por si só o RPO contratado. Precisamos validar o uso real de autenticação multiempresa e faturamento em ambiente seguro e manter cópias externas para evitar dependência exclusiva do GitHub.

Sem resultado `PASS` do ensaio independente, **não homologar** a restauração de artefato armazenado.


### Fluxo confirmado em 21/11/2026

**Backup real aprovado:** https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44924143771

**Recuperação independente aprovada:** https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44924319356

Total de 3 arquivos privados, 2.378.927 bytes, incluídos no mesmo pacote AES-256 do banco e reconstruídos sem consultar a origem. A recuperação de laboratório durou 13 segundos; não confundir com RTO de incidente. A cópia armazenada no Actions expira em 21/12/2026.

A função `nexus-central-storage-backup` foi implantada na Central com verificação JWT **na própria função**, usando tokens OIDC assinados do GitHub; sua configuração `verify_jwt=false` na camada de gateway é intencional somente porque o emissor dos tokens não é o Supabase. Qualquer outra implantação deve manter a verificação criptográfica RS256, o repositório/ID imutável, a branch e o workflow autorizados. Ela permite apenas GET de um bucket, não gera links públicos, não oferece operações de escrita e nunca requer guardar uma chave `service_role` no GitHub.

**Importante:** a senha de criptografia protegida por GitHub Actions deve também existir em cofre autorizado e recuperável fora do GitHub. Sem um meio independente de recuperar a senha e o arquivo cifrado, o sistema não garante continuidade durante uma indisponibilidade ou perda de acesso ao GitHub.
