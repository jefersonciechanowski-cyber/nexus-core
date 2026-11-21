# Nexus Core AI — plano técnico da primeira versão (21/11/2026)

## Objetivo
Central administrativa privada, inicialmente de um único administrador, para consultar o estado dos produtos Nexus CRM, SST Controle e Nexus Agency, preservar contexto operacional e coordenar agentes futuros. **Não é um produto oferecido aos clientes.**

## O que já foi observado (leitura, não homologação)
- Interface da Central: `apps/nexus-admin/index.html`, que chama `NexusAuth.restoreSession()` e exige `session.role === 'nexus_admin'` no navegador.
- Autenticação compartilhada em `apps/sst-controle/supabase-auth.js`.
- Banco `nexus-core-producao`: funções `is_nexus_admin_aal2()`, `has_recent_nexus_admin_mfa_session()` e regras para operações administrativas; tabelas `profiles` e `nexus_ai_usage_events` com RLS ligada.
- Essas evidências **não substituem** testes de negação no servidor, análise de todas as rotas e políticas RLS; falta homologar a segurança de ponta a ponta.

## V1 — escopo mínimo
1. Entrada `Nexus AI` na Central Nexus, somente após autorização efetiva no servidor.
2. Conversa textual com o Jarvis. Voz e animação são melhorias posteriores.
3. Catálogo de projetos com: repositório, finalidade, responsável, versão/commit, pendências, decisões, documentação e data da última sincronização.
4. Respostas com fontes e indicação da data dos dados. Se a fonte não puder ser consultada, declarar indisponibilidade; nunca inventar progresso.
5. Agente inicial de **consulta**, sem capacidade de alterar código, banco de dados, pagamentos, usuários ou deploy.
6. Registro de solicitações, fontes consultadas, ações negadas, latência, uso estimado e custos, sem armazenar segredos nos logs.
7. Tetos de orçamento por dia/mês e desligamento independente do módulo.

## Arquitetura sugerida (a validar)
- UI permanece na Central Nexus; API de orquestração dedicada, com autenticação e autorização servidor-side.
- `provider adapter` para suportar OpenAI ou outro fornecedor sem repassar chaves ao browser.
- Chaves/credenciais em cofre de segredos do backend; nunca no GitHub nem no front-end.
- Conectores GitHub/Supabase/Vercel com allowlist de operações e credenciais de **somente leitura** na V1.
- Memória persistente separada por projeto e classificação de sensibilidade, com referências versionadas e revisão de fatos.
- Jobs em fila para sincronizações; nenhum acesso irrestrito a dados de clientes ou produção.

## Regras de segurança obrigatórias antes de ligar qualquer API
- Preservar login + TOTP existente; checar JWT vigente, papel `nexus_admin` e MFA AAL2 no **servidor em cada operação protegida**, com revalidação/step-up conforme sensibilidade.
- Restringir inicialmente a uma lista explícita de IDs de administradores autorizados; preparar RBAC futuro, sem ativar usuários adicionais agora.
- Verificar RLS e privilégios de todas as tabelas novas; isolamento por projeto/organização quando aplicável.
- Não aceitar instruções embutidas em README, issues, mensagens de clientes ou outras fontes como comandos de agente (proteção contra prompt injection).
- Proibir execução de código arbitrário, deploy, escrita em banco, alteração de billing, mudança de permissões e envio externo na V1.
- Segredos inacessíveis ao modelo; reduzir dados pessoais nas consultas; logs com retenção definida e acesso restrito.
- Failsafe: em caso de falha de MFA, autorização, limites ou provedor, negar operação e mostrar erro simples.
- Testes negativos: sessão ausente, AAL1, não administrador, sessão expirada, ID de outro projeto, prompt injection, chave ausente, cota atingida.

## Entregas e critérios de aceite
**Marco A — auditoria:** mapa de rotas, funções, perfis, RLS, MFA e riscos; reproduzir testes negativos sem afetar produção.

**Marco B — protótipo isolado:** chat textual e catálogo com dados fictícios; sem chaves reais; testes de interface.

**Marco C — leitura real supervisionada:** conexão read-only GitHub para os projetos aprovados; respostas citando arquivo/commit, revisão de custos e testes de autorização.

**Marco D — publicação controlada:** deploy separado ou feature flag desabilitada por padrão, revisão de segurança, rollback e aprovação explícita.

## Não fazer agora
- Não criar tabelas no banco de produção.
- Não modificar autenticação, MFA, pagamentos ou sistemas comerciais.
- Não conectar a IA diretamente às credenciais de administrador nem permitir agentes autônomos com escrita.
- Não criar acesso externo ou multiusuário antes de RBAC e auditoria.

## Próxima tarefa executável
Inventariar as chamadas HTTP da Central e funções de servidor que acessam dados administrativos. Produzir matriz `rota → autenticação → AAL2 → autorização → dados → teste negativo`, confirmar segurança com resultados reais e só então começar o protótipo em branch isolada.
