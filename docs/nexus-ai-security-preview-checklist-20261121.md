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


## Complemento de revisão — proteção MFA no script de piloto

Inspeção adicional de `apps/nexus-admin/pilot.js`: a função `enforceAdminMfaSession()` é chamada antes de montar o formulário de piloto. Ela exige `nexus_admin`, verifica `client.auth.mfa.getAuthenticatorAssuranceLevel()` com `currentLevel === 'aal2'`, confirmação TOTP recente e marcador local, usando limite de 7.200 segundos (2 horas). Se falhar, faz logout local e retorna ao login. **Evidência positiva de defesa na UI; não prova autorização no backend ou em todos os outros fluxos.** A coluna MFA da matriz anterior diz respeito apenas aos arquivos inicialmente examinados.

O último comentário do Cloudflare no PR #239 confirmou outro build com erro para commit `665eff85`. A tentativa de abrir o endereço de preview externamente também não obteve resposta útil. A causa exata ainda requer logs; não modificar build/deploy em produção sem diagnosticar.

## Decisão de produto aprovada — Nexus AI V1 (21/11/2026)

- Preservar visual futurístico da Central Nexus com esfera luminosa e animações **leves**, preferencialmente CSS, sem chamadas de IA durante animação ociosa; respeitar `prefers-reduced-motion` e desempenho mobile.
- **Primeira entrega funcional:** chat **por texto** utilizando um modelo da NVIDIA via backend, somente após revisão de segurança, validação das condições de uso comercial e aprovação dos custos.
- **Voz:** fase posterior, condicionada à medição do uso, custo, latência e valor gerado.
- **Controle financeiro obrigatório:** registrar consumo por agente/modelo, teto mensal configurável, alertas, bloqueio de novas chamadas ao alcançar o limite e sem fallback oneroso inesperado. Definir valor do teto antes de habilitar API real.
- O protótipo atual permanece demonstrativo, sem API real nem acesso a dados de clientes; nada de integração direta da chave no frontend.
- **Responsabilidades:** NVIDIA para consulta e respostas no Nexus AI; ChatGPT/desenvolvimento com execução apenas em fluxos autorizados, sem escrita autônoma na V1.

**Status:** decisão funcional registrada; implementação e homologação dessas regras ainda pendentes. Não publicar em produção apenas por esta aprovação de escopo.
