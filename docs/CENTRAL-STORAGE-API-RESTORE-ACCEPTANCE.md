# Central — reimportação segura do Storage em projeto Supabase descartável

O backup real da Central (PostgreSQL + bytes privados de Storage) já foi aprovado. O script `scripts/central-storage-api-restore.py` adiciona uma etapa separada de **reupload e download por API**, para testar se os arquivos recuperados do pacote cifrado continuam íntegros num Storage Supabase recém-provisionado.

## Limites de segurança

- Só aceita um destino Supabase explícito, confirmado duas vezes, no formato `https://<ref>.supabase.co`.
- Bloqueia expressamente os projetos de produção conhecidos da Central, CRM e Agency. **Não executar em qualquer outro projeto com clientes ou dados reais.**
- Exige que o bucket `sst-documents` já exista e seja **privado** no destino. A validação de configuração do bucket e as regras RLS precisam ser verificadas separadamente.
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
