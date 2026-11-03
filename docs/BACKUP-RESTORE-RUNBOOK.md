# Nexus Core / Nexus SST — Runbook de Backup e Restauração

Este procedimento existe para validar recuperação sem tocar no ambiente de produção.

## Objetivo
Provar que um backup pode ser restaurado e que o ambiente restaurado mantém schema, funções, RLS e dados esperados.

## Regras de segurança
- nunca restaurar sobre produção;
- nunca usar credenciais de produção em arquivos versionados;
- executar a restauração somente em projeto/branch isolado;
- não compartilhar dump contendo dados pessoais fora do ambiente controlado;
- apagar/encerrar o ambiente temporário após a validação conforme política interna.

## Evidências a registrar
- data e hora do backup;
- data e hora da restauração;
- versão/commit relacionado;
- origem e destino do teste;
- duração aproximada;
- tabelas/amostras validadas;
- resultado do teste de login/autorização;
- resultado das policies RLS;
- resultado de funções críticas;
- responsável;
- conclusão PASS/FAIL.

## Validação mínima após restauração
1. confirmar migrations/schema esperados;
2. confirmar RLS habilitado nas tabelas de negócio;
3. validar que um usuário de uma organização não lê dados de outra;
4. conferir registros de exemplo controlados;
5. validar funções/RPCs críticas;
6. validar integridade de chaves estrangeiras e contagens básicas;
7. registrar falhas e não considerar o gate concluído até novo teste PASS.

## Registro do teste

Data: ______________________
Origem: ____________________
Destino isolado: ___________
Commit/versão: _____________
Responsável: _______________
Duração: ___________________

Resultado:
- [ ] PASS
- [ ] FAIL

Observações:

____________________________________________________________________
