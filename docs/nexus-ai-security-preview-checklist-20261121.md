# Nexus AI — verificação inicial e pendências (21/11/2026)

**Escopo:** auditoria estática inicial do código GitHub, sem executar chamadas autenticadas nem alterar Supabase, Cloudflare ou produção. Branch `feat/nexus-ai-foundation-20261121`.

## Evidências verificadas

| Objeto | Evidência | Situação | Verificação ainda necessária |
|---|---|---|---|
| Entrada Central | `apps/nexus-admin/index.html`, função `start()`: `NexusAuth.restoreSession()` e comparação `session.role !== 'nexus_admin'` | Verificação no navegador identificada; **não é prova de autorização no servidor** | Reproduzir negação via acesso direto aos endpoints sem UI, com sessão não-admin |
| Sessão | `apps/sst-controle/supabase-auth.js`, `restoreSession()` e `loadProfile()` | Sessão/perfil são carregados no cliente | Testar JWT inválido, expirado e revogado em operações administrativas |
| MFA da página | Não identificada chamada direta a `getAuthenticatorAssuranceLevel()` nem `aal2` nos dois arquivos acima | **Sem evidência de enforcement no cliente da Central**, o que por si só não implica falha no backend | Validar políticas RLS, grants, funções RPC e handlers com usuário AAL1 e AAL2 |
| Acesso a dados | `index.html` invoca `NexusAuth.getClient().from(...)` e faz gravações administrativas | O controle definitivo depende das regras reais do banco | Mapear tabela por tabela, policy e teste de negação |
| Protótipo | `apps/nexus-admin/nexus-ai-prototype.html` possui apenas dados demonstrativos, sem chamadas de rede no código próprio | Maquete não autenticada, sem segredos no arquivo verificado | **Não disponibilizar como recurso privado** até existir proteção de servidor; `noindex` não é controle de acesso |
| Preview | Comentário do bot Cloudflare no PR #239 indicou `Deployment failed` para commit `16b78b82` | Publicação da prévia **não confirmada** | Obter logs do build e conferir configuração/roteamento do Worker; não presumir causa específica |

## Matriz mínima de testes de segurança para a V1

| Caso | Esperado |
|---|---|
| Sem sessão | 401/403 e nenhuma leitura administrativa |
| Login com perfil comum | 403 mesmo acessando API diretamente |
| Administrador com AAL1 | 403 nas operações que exigem AAL2 |
| Administrador AAL2 | Apenas operações de leitura explicitamente permitidas |
| Token expirado/revogado | Falha fechada, sem dados |
| Organização ou projeto não autorizado | Nenhuma informação retornada |
| Entrada maliciosa / prompt injection em fonte | Tratada como dado, não como instrução |
| Tentativa de alterar usuários, pagamentos, código ou deploy | Ação indisponível na V1 |
| API NVIDIA indisponível ou sem orçamento | Erro claro e sem fallback inseguro |

## Bloqueios para implementação integrada

1. Confirmar cada política RLS e função administrativa usada pela Central com testes reais de acesso AAL1/AAL2 em ambiente seguro.
2. Identificar a origem do erro de build Cloudflare nos logs do deployment, antes de ajustar qualquer rota.
3. Hospedar a maquete apenas com controle de acesso se o objetivo for preview privado. Não tornar a Central, seus dados ou endpoints públicos para resolver a prévia.
4. Integrar NVIDIA somente via backend com chave no gerenciador de segredos, orçamento limitado, consulta read-only, redaction e fonte/data de atualização.
5. Não alterar login/MFA atual nem publicar código da V1 na produção antes de revisão e homologação.

**Nota:** esta é uma auditoria estática parcial. Não afirma que o banco está vulnerável nem que MFA/RLS falharam; esses resultados só podem ser declarados após testes reais.
