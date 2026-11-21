# Nexus Central — verificação da recuperação isolada (20/11/2026)

**Estado: preparação técnica. Backup real ainda não restaurado; critério pendente.**

## Pré-condições

1. Identificar um backup real da Central, informar a data UTC e calcular checksum sem publicar valores ou arquivos.
2. Restaurar em máquina isolada, nunca em cima da produção. Desabilitar TODAS as saídas de rede, cobranças Asaas, automações, workers, crons, webhooks, e-mails, Meta e WhatsApp antes de carregar o backup.
3. Manter conexão PostgreSQL somente via localhost ou 127.0.0.1. O banco restaurado deve conter public, auth, RLS e funções relevantes.
4. Usar conta autorizada no banco isolado (a consulta verifica auth.users).

## Verificação

Em uma máquina de testes que contenha psql, executar o script:

```bash
export NEXUS_ISOLATED_RESTORE=1
export RESTORE_DB_URL="postgresql://postgres@127.0.0.1:5432/central_restore"
bash scripts/verify-central-restore.sh
```

O endereço é ilustrativo; não registrar credenciais em arquivos de log. O script é somente leitura, retorna contagens e impede destinos remotos.

Comparar os resultados ao mesmo instante de geração do backup (não comparar cegamente a produção atual a uma cópia antiga). Conferir contagens de empresas, usuários, conta Nexus, acessos/contratos, checkouts, pagamentos, estados ativos/suspensos e assinaturas. Se algum vínculo órfão for encontrado, investigar; zero é obrigatório para o aceite.

Completar teste de permissões com dois usuários de empresas diferentes e um administrador, sem copiar dados. Registrar horário de início e término, idade do backup, RTO, RPO, divergências justificadas e confirmação de ausência de envios/cobranças.

## Aceite de restauração

Exige evidência de cópia realmente restaurada, timestamp, checksum, contagens equivalentes ao backup, vínculos sem divergência, testes de acesso, MFA pertinente e medição RTO/RPO. O sucesso de consultas em produção ou do teste estático em CI não fecha este critério.

Guardar somente métricas agregadas no dossiê. Não anexar backups nem informações pessoais no repositório público.
