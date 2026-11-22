# Central — reimportação segura do Storage em projeto Supabase descartável

O backup real da Central (PostgreSQL + bytes privados de Storage) já foi aprovado. O script `scripts/central-storage-api-restore.py` adiciona uma etapa separada de **reupload e download por API**, para testar se os arquivos recuperados do pacote cifrado continuam íntegros num Storage Supabase recém-provisionado.

## Limites de segurança

- Só aceita um destino Supabase explícito, confirmado duas vezes, no formato `https://<ref>.supabase.co`.
- Bloqueia expressamente os projetos de produção conhecidos da Central, CRM e Agency. **Não executar em qualquer outro projeto com clientes ou dados reais.**
- Exige que o bucket `sst-documents` já exista e seja **privado** no destino. Antes de enviar qualquer documento, consulta a API de metadados do bucket e recusa `public=true`, ausência do bucket ou resposta inválida. Políticas RLS de usuários autenticados ainda precisam de validação funcional separada.
- Nunca usa credenciais da Central original, gera URLs públicas ou altera `storage.objects` diretamente. O token `CENTRAL_STORAGE_RESTORE_TOKEN` é **exclusivo do projeto temporário**, deve ser fornecido como segredo restrito ao teste, jamais commitado.
- Falha diante de qualquer manifesto inesperado, arquivos adicionais, symlinks, caminho malformado, bytes truncados, hash diferente ou URL de produção.
- O upload não sobrescreve objetos existentes (`x-upsert: false`) e exige readback por API autenticada com hash SHA-256 idêntico. Ao primeiro erro, não aprova a recuperação.
- Os arquivos reais só podem ser extraídos do `tar.gz.gpg` em workspace temporário protegido do GitHub Actions. Não publicá-los em PRs nem artefatos sem criptografia.

## O que já foi testado

O teste `tests/central-storage-api-restore-safety.py` é **sintético**, com documentos totalmente fictícios e chamadas HTTP simuladas. Ele verifica recusa de destinos de produção, bloqueio de corrupção/path traversal, montagem do POST de reimportação e verificação do GET autenticado, incluindo erro de hash. Não realiza qualquer gravação na produção nem prova ainda o reupload numa plataforma Supabase nova.

## Para a homologação definitiva

1. Criar ou selecionar um projeto Supabase **temporário e sem clientes**, em uma conta/plano com disponibilidade, com bucket privado e políticas testadas. Não criar projeto pago automaticamente sem aprovação do titular.
2. Configurar um ambiente GitHub Actions protegido, exigir aprovação humana do operador e cadastrar **somente** a chave temporária do destino; proibir as chaves da Central original.
3. Executar a reimportação sobre os arquivos descriptografados apenas no runner isolado. Comparar contagem de 3 objetos, tamanho total, SHA-256 de cada arquivo e regras de acesso com usuários fictícios.
4. Destruir o ambiente temporário, **revogar a credencial**, registrar data/hora, link da execução e resultados agregados.
5. Medir o processo completo para RTO/RPO incluindo recuperação do banco, Storage, Auth, Edge Functions, DNS, SMTP e Asaas. Manter uma cópia cifrada fora do GitHub para reduzir dependência do fornecedor.

**Estado:** reimportação real por API em projeto Supabase temporário **ainda pendente**. O teste com respostas simuladas não conta como homologação completa do critério 17. O monitor diário de backups e o ensaio independente real do arquivo cifrado permanecem ativos.

## Evidência adicional — API real em Supabase LOCAL (22/11/2026)

- [PR #245](https://github.com/jefersonciechanowski-cyber/nexus-core/pull/245), incorporado na `main`.
- [GitHub Actions 44965006913](https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44965006913), **PASS** (7/7 verificações do PR).
- O ensaio levantou a stack oficial Supabase CLI v3 em Docker efêmero, fez upload e leitura de **três arquivos fictícios**, conferiu hashes, bloqueou acesso sem token/anon e recusou sobrescrita. Depois removeu a stack local.
- Nenhum arquivo real do cliente, segredo de produção ou projeto Supabase hospedado foi usado. O teste anterior com mocks continua útil para falhas negativas; o novo ensaio comprova que o código consegue falar com uma API Storage Supabase real, mas **somente local e com dados fictícios**.

**Não homologado ainda:** reimportar os 3 arquivos privados reais num **projeto Supabase temporário hospedado**, verificar acesso funcional de usuários de teste com regras RLS correspondentes às da Central e completar Auth/Asaas/SMTP/DNS/Edge Functions, cofre/segunda cópia e RTO/RPO total. O critério formal 17 continua pendente; placa geral permanece 16/18.

## Prova real adicional sem projeto hospedado — 22/11/2026 (UTC)

- [PR #247](https://github.com/jefersonciechanowski-cyber/nexus-core/pull/247) aprovado e mesclado; [execução GitHub Actions 44966078715](https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44966078715) concluída com **success**.
- O runner fez download do artefato cifrado **já armazenado** da Central (backup de origem 44924143771), validou o SHA-256, decifrou em diretório efêmero, extraiu somente os membros privados autorizados e aplicou a mesma rotina de upload/readback à API Storage **Supabase local real**.
- Resultado do teste: **3/3 arquivos privados reais**, **2.378.927 bytes**, integridade validada após readback autenticado; acesso sem autenticação e com chave anon negado. Limpeza da stack, volumes e arquivos de trabalho concluída no job.
- O workflow usa runner padrão público do GitHub, não cria projeto pago e não acessa Central/CRM/Agency de produção. Após a aprovação, a rotina passa a exigir **execução manual em main**, com ação Supabase CLI fixada por SHA, para reduzir risco de execução desnecessária com documentos reais.
- **Limites:** a prova é de serviço Storage em `localhost` no GitHub Actions. Não confirma implantação hospedada de backup num projeto novo, login de usuários reais no Auth reconstruído, RLS entre empresas na API da aplicação, nem recuperação DNS/SMTP/Asaas/Edge Functions. Não representa RTO/RPO integral.

**Aceite formal do DR integral continua pendente**; não avançar 17/18 apenas com a prova local. Buscar cópia criptografada independente do GitHub e acesso ao segredo fora dele antes de prometer continuidade de serviço.
