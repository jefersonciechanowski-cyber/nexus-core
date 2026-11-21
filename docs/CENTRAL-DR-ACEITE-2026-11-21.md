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
| Storage objects | 3 objetos (~2.378.927 bytes declarados) | **Bytes não incluídos** no `.dump` |
| Edge Functions | 65 implantadas | 57 têm `index.ts` na `main`; 8 funções não encontradas no repositório |
| Auth e integrações | 5 usuários internos no dump; provedores, chaves, SMTP, DNS, Asaas externos | Dados internos preservados; configurações e segredos externos não restaurados |

O bucket privado não deve ser exposto publicamente para facilitar backup. Implementar futuramente exportação autenticada e criptografada **sem inserir tokens no código, issues ou logs**. Não basta registrar `storage.objects`: é preciso testar os bytes recuperados e ACLs dos objetos. Nunca criar links públicos para esses arquivos.

Funções implantadas sem fonte em `supabase/functions/<slug>/index.ts` na `main` durante a auditoria: `nexus-part1-billing-acceptance`, `nexus-part3-ordering-acceptance`, `nexus-crm-stripe-test-webhook`, `nexus-crm-billing-acceptance-step`, `nexus-crm-billing-acceptance-run`, `nexus-crm-entitlement-diagnostic-once`, `nexus-public-crm-sales-test`, `nexus-crm-billing-acceptance-once`. Classificar cada uma como essencial ou legado antes de recuperar publicamente o código; nunca publicar fontes sem revisão de segredos.

## Aceite do critério 17 — requisitos restantes

- [x] Backup e restauração com dados reais, integridade relacional, autenticação armazenada, ACL/RLS e funções restauradas
- [x] Recarga do artefato **criptografado já armazenado** e recuperação independente da base original
- [x] Negativa RLS para usuário fictício sem vínculo
- [ ] Testes positivos e negativos de um **membro de organização real, somente no banco restaurado**, e consistência funcional de pagamento/contrato sem cobranças
- [ ] Backup e ensaio de recuperação de bytes do Storage privado
- [ ] Origem reproduzível das 8 Edge Functions não versionadas ou desativação justificada, com validação de restauração
- [ ] Plano de restauração externo (Auth, SMTP, DNS, Asaas, secrets) com responsabilidades e evidência funcional
- [ ] RTO/RPO de **serviço completo** medidos e aceitos, com cópia independente do GitHub ou risco formalmente aceito

Mesmo com a confirmação do GitHub Actions como `success`, **não aprovar automaticamente o critério 17** se essas pendências continuarem.

## Critério 18 — Google Search Console

Em 21/11/2026 o OpenSEO ainda não possui conta Google Search Console conectada nos projetos Nexus CRM ou Nexus Core. A autorização Google depende da ação explícita do responsável na interface de OAuth. Não marcar o último critério como concluído até confirmar a propriedade correspondente no OpenSEO.

Link para conectar: https://app.openseo.so/p/381654de-eb74-4c9c-89f5-1d3c469a4988/search-performance
