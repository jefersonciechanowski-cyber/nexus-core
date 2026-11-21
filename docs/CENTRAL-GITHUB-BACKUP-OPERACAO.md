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
- Documentar RTO/RPO reais e o plano para bytes de Storage, Edge Functions, DNS, Auth e provedores externos, que não estão cobertos pelo backup lógico atual.
- Confirmar que um administrador autorizado consegue **obter e decifrar** o artefato sem expor segredo ou dados a terceiros.

**Política de aprovação:** não contar este critério como homologado por existir um workflow, pela passagem da CI sintética ou por ter gerado um arquivo criptografado; deve haver evidência de restauração completa e validação funcional.

O repositório é público. O artefato contém dados reais **cifrados**; mantenha a senha de cifragem aleatória, de alta entropia e fora do GitHub, e revise as permissões de acesso ao Actions antes de executar. Repositório privado e armazenamento com retenção mais longa devem ser avaliados antes de usar isto como único mecanismo de recuperação.

O procedimento histórico local consta de `docs/CENTRAL-OFFLINE-RESTORE-DRILL-2026-11-21.md`, mas **não é mais o caminho operacional preferido**. Nenhum PowerShell no computador, Make ou n8n é exigido para o fluxo GitHub.


## Integridade do pacote lógico

O artefato GPG AES-256 validado contém um pacote `tar.gz` com dois arquivos inseparáveis: `central.dump` (dump PostgreSQL 17) e `sequence-acl.sql` (manifesto com as permissões **explícitas** de sequências `public` que o dump nativo pode não reproduzir integralmente). Ambos são derivados da origem somente-leitura e cifrados juntos.

Numa restauração **offline**, aplique o dump ao banco descartável e depois aplique o manifesto de ACL somente nesse ambiente antes de comparar os fingerprints de segurança. O GitHub Actions faz essa verificação e só publica o pacote cifrado após a aprovação. Não execute o manifesto em produção; não divulgue seu conteúdo ou arquivos decifrados.

Este fluxo testa a geração de uma cópia corrente e a recuperação de seus componentes no mesmo ensaio; um desastre real ainda exige recuperar o artefato armazenado, decifrar, restaurar sem depender da origem e validar dependências externas/RTO/RPO.



## Ensaio independente de recuperação do artefato armazenado (GitHub)

O workflow `.github/workflows/central-stored-artifact-restore.yml` roda depois de um backup **real bem-sucedido**, pode ser acionado manualmente e tem agendamento semanal. Ele baixa o pacote criptografado já guardado no GitHub, confere SHA-256, decifra em diretório temporário do runner, verifica os cinco arquivos esperados, restaura em PostgreSQL 17 sem rede, reaplica as ACLs explícitas das sequências e compara as assinaturas de segurança/integração com as que foram salvas no pacote. Exige também uma negativa de RLS para um usuário fictício sem vínculo.

O ensaio de armazenamento não recebe `CENTRAL_SOURCE_DATABASE_URL`: valida de forma independente a capacidade de restaurar os dados salvos **sem conexão à Central original**. Ele depende apenas da senha de criptografia guardada no GitHub e da disponibilidade do artefato, que expira após 30 dias. Os logs incluem somente tempos, status e resultados agregados.

### Limites e exigências de desastre real

Esse ensaio não demonstra restauração integral do Supabase como serviço: Storage (bytes), SMTP, DNS, provedores de Auth, Edge Functions, segredos externos e outras dependências exigem plano e validação próprios. A duração do ensaio não é automaticamente o RTO num incidente, e a idade do snapshot não comprova por si só o RPO contratado. Precisamos validar o uso real de autenticação multiempresa e faturamento em ambiente seguro e manter cópias externas para evitar dependência exclusiva do GitHub.

Sem resultado `PASS` do ensaio independente, **não homologar** a restauração de artefato armazenado.
