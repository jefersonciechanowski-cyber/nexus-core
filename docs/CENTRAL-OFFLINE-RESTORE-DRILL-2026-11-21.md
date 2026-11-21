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
