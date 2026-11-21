# Ensaio de restauração da Central no Windows — 21/11/2026

**Objetivo:** testar um backup lógico real do banco PostgreSQL da Central, sem sobrescrever a produção e sem enviar dados do usuário a terceiros. O procedimento abaixo não cria projetos Supabase nem altera cobranças.

## Pré-requisitos

- Windows com Docker Desktop aberto e Linux containers habilitados.
- Git ou uma cópia dos arquivos do repositório Central.
- Acesso autorizado ao Supabase da **Central** (não ao CRM), referência `svphwbccqeoakpmcpvhy`, para obter a URI de conexão de banco no painel. **A URI contém senha e deve permanecer apenas no computador.**
- Estar em um ambiente privado, com computador confiável e disco criptografado. O arquivo temporário do dump pode conter dados pessoais e hashes de autenticação.

## Execução no próprio Windows

1. Abra PowerShell no diretório raiz deste repositório (`nexus-core`). Confirme que `docker info` funciona.
2. Rode:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\central-restore-drill.ps1
   ```

3. Quando solicitado, cole a URI da Central na entrada **oculta**. Não cole a URI no ChatGPT, GitHub, prints ou logs públicos.
4. O script valida a referência da Central, lê a origem, gera `pg_dump` customizado (`public`, `auth`, `storage`), restaura no PostgreSQL 17 local **com `--network none`**, compara os resumos de dados e estados, executa `central-restore-integrity.sql` e elimina automaticamente container e arquivo temporário.
5. Se concluir com `"outcome": "PASS"`, compartilhe apenas o JSON final sem dados pessoais. Ele contém hash do arquivo, tempo medido e contagens, não o conteúdo do backup.

**Não** use `-KeepBackup` salvo se souber armazenar o arquivo em mídia privada, criptografada e com política de retenção. O padrão apaga o arquivo assim que o ensaio termina.

## O que o aceite exige

- Captura de backup real com data UTC, SHA256, versão PostgreSQL e fonte Central corretamente identificada.
- Restauração sem erros em banco **isolado**, com saída de rede desativada.
- Contagens e digest operacional de empresas, usuários, papéis, contas, vínculos, acessos e pagamentos iguais à origem no instante capturado.
- Nenhum vínculo de organização, conta, usuário ou acesso órfão. Conservação de RLS/funções/políticas relevantes.
- Teste de autorização usando usuários reais ou descartáveis em ambiente isolado, incluindo negativa de leitura entre duas empresas; o script testa a integridade e a presença de dados, mas **não realiza login do Supabase Auth**.
- Registro de duração do ensaio e da idade do backup. A duração não é automaticamente o RTO do incidente, e a idade do dump não equivale à garantia de RPO.
- Descrição explícita do que não foi restaurado: bytes de objetos Supabase Storage, configurações de serviços externos, senhas de integração e outros recursos fora do banco.

**Se o script falhar em dependência de extensão/role do Supabase, não afirme que houve restauração**. Será necessário um ambiente de PostgreSQL compatível com as extensões presentes na origem; nunca instalar extensões não verificadas na produção só para fazer o teste.

## Proteções auditadas no script

O script recusa URI de origem que não pertença à Central, não inclui senha na linha de comando Docker, não imprime dados de clientes e não conecta o banco restaurado à rede. O teste automatizado do GitHub usa apenas a fixture sintética de `tests/sql/central-offline-restore-synthetic.sql`; nenhuma senha ou dado real existe no workflow.

Referência oficial: https://supabase.com/docs/guides/platform/backups

No plano Free do Supabase não há backups automáticos disponíveis no painel. A recomendação oficial é manter backups lógicos manuais e externos. O script é um ensaio de restauração, não uma política permanente de backup.


## Auditoria de segurança da restauração (21/11/2026)

O ensaio sintético inicial era incompleto: o `pg_dump` ignorava os donos e os `GRANTs` dos objetos. A inspeção somente-leitura da Central identificou 95 objetos com ACLs explícitas, 83 objetos com RLS e 214 políticas RLS nos esquemas públicos e gerenciados, além de proprietários diferentes para `public`, `auth` e `storage`.

A versão corrigida preserva proprietários e permissões do arquivo lógico e compara **duas assinaturas** antes/depois do backup e depois da restauração: (1) contagens e estados operacionais, (2) assinaturas de donos de objetos/esquemas, `GRANTs` de tabelas/esquemas/funções, políticas RLS, proprietários e definições das funções privilegiadas. A conexão de origem utiliza parâmetros `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGSSLMODE` e `PGOPTIONS` com transações somente-leitura, evitando senha no argumento de processo. O contêiner de origem é removido; quem administra o Docker local ainda pode visualizar variáveis de ambiente durante a operação.

O ensaio com dados **100% fictícios** foi aprovado em:
https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44893106681

Na execução, foram aprovadas 19 métricas de integridade, comparação de privilégios e leitura isolada de duas empresas fictícias. O controle negativo revogou uma permissão em um contêiner **descartável**, e o script recusou a restauração, como esperado. O tempo medido, 5,77 segundos, é apenas referência do laboratório sintético.

**Limitações que permanecem:** o backup lógico não inclui atributos e vínculos de papéis globais do cluster PostgreSQL, credenciais de autenticação externas, conteúdo dos objetos Storage, funções Edge ou configurações de serviços externos. A Central real usa extensões e funções gerenciadas pelo Supabase; sua restauração no PostgreSQL padrão só será aceita se todos os comandos funcionarem sem ignorar erros e os digests coincidirem. Isso não comprova, por si, autenticação multiempresa ponta-a-ponta ou capacidade de retomada do serviço. Não confundir o teste sintético com DR/RTO/RPO validados.

**Próxima ação para concluir o 17º critério:** executar o procedimento com a URI real da Central no computador autorizado; não enviar URL, senha, arquivo `.dump`, tokens ou dados pessoais por chat ou GitHub. Conferir o JSON agregado, o checksum SHA-256, a consistência das permissões, o tempo real e a idade do backup; complementar com validação funcional da autorização entre empresas em ambiente isolado.
