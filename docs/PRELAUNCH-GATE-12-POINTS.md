# Nexus Core / Nexus SST — Gate de Pré-Publicação em 12 Pontos

Data de adoção: 06/09/2026

Este checklist é obrigatório antes de liberar o Nexus SST para novos clientes reais. Itens P0 bloqueiam publicação até validação explícita. Itens P1 devem estar concluídos no ciclo de lançamento. O item P2 é melhoria não bloqueante.

## P0 — Bloqueadores obrigatórios

### 1. Revisão de segurança no código
**Objetivo:** impedir exposição de dados, falhas de autorização, injeção, privilégios excessivos e regressões.

**Já existente:**
- RLS e isolamento por organização;
- hardening de banco e storage;
- CI de segurança;
- auditoria de dependências;
- verificações de CSP e senhas hardcoded;
- Security Advisor do Supabase como gate de revisão.

**Gate antes de publicar:**
- workflow de segurança verde;
- Security Advisor revisado;
- qualquer WARN/ERROR novo classificado como corrigido ou intencional/documentado;
- rotas públicas, webhooks e funções `SECURITY DEFINER` revisadas individualmente;
- nenhum acesso cross-tenant em testes.

### 2. Nenhum segredo no repositório
**Objetivo:** garantir que `service_role`, chaves secretas, tokens, senhas, private keys e signing secrets nunca sejam versionados.

**Gate antes de publicar:**
- scanner de secrets verde no CI;
- arquivos `.env*` privados fora do Git;
- somente placeholders em `.env.example`;
- revisar histórico quando houver suspeita de exposição;
- qualquer segredo que tenha sido exposto deve ser rotacionado antes do go-live.

### 3. Rate limit em login, cadastro e endpoints sensíveis
**Objetivo:** limitar abuso, bots, brute force e criação massiva de contas.

**Já existente:**
- rate limit server-side para fluxos públicos do Nexus;
- tabela de contadores protegida e função de consumo restrita ao backend.

**Gate antes de publicar:**
- revisar limites do Supabase Auth para login, signup, recuperação e OTP;
- confirmar limites em endpoints públicos de venda, suporte e onboarding;
- validar resposta `429`/bloqueio controlado em teste de abuso;
- garantir que o limite não dependa somente do frontend.

### 4. Monitoramento de erros com alerta
**Objetivo:** descobrir falhas antes do cliente.

**Gate antes de publicar:**
- escolher fonte de observabilidade/alerta para produção (ex.: logs estruturados + alerta, Sentry ou equivalente);
- alertar sobre erros críticos, falhas de webhook, falhas de e-mail e 5xx;
- incluir contexto técnico sem registrar senha, token ou dado sensível;
- executar teste controlado e confirmar recebimento do alerta.

### 5. Termos de Uso, Privacidade e LGPD
**Objetivo:** definir tratamento de dados, responsabilidades, finalidades, retenção e direitos do titular.

**Já existente:**
- páginas públicas de Privacidade e Termos;
- consentimento de cookies de marketing;
- Pixel Meta condicionado a consentimento.

**Gate antes de publicar:**
- revisar razão social/CNPJ/contatos e dados comerciais definitivos;
- revisar escopo para cobrir o Nexus SST e serviços conectados;
- descrever subprocessadores relevantes quando aplicável;
- validar canal para solicitações de titulares;
- garantir que links estejam acessíveis antes do cadastro/contratação.

### 6. Backup com restauração realmente testada
**Objetivo:** provar capacidade de recuperação, não apenas existência de backup.

**Gate antes de publicar:**
- confirmar política de backup do banco de produção;
- gerar backup/exportação controlada quando aplicável;
- restaurar em ambiente isolado/temporário;
- validar schema, funções, RLS e amostra de dados restaurados;
- registrar data, responsável, duração e resultado do teste;
- nunca testar restauração por cima da produção.

### 7. E-mail transacional e recuperação de senha
**Objetivo:** garantir onboarding e recuperação de acesso confiáveis.

**Já existente:**
- fluxo de primeiro acesso;
- recuperação/redefinição de senha;
- alertas preventivos;
- integrações de e-mail no backend.

**Gate antes de publicar:**
- remetentes/domínios finais validados;
- testar primeiro acesso, recuperação de senha e alerta;
- testar Gmail e Outlook;
- verificar Spam/Lixo Eletrônico;
- conferir links no domínio final e expiração;
- confirmar logs de falha/entrega sem exposição de conteúdo sensível.

## P1 — Obrigatórios no ciclo de lançamento

### 8. Search Console + sitemap.xml + robots.txt
**Já existente:** `robots.txt` e `sitemap.xml` no Nexus Core.

**Gate:**
- conferir URLs canônicas;
- confirmar que áreas privadas/autenticadas não estão indexáveis;
- validar sitemap no domínio final;
- cadastrar/validar propriedade no Google Search Console e inspecionar as páginas públicas principais.

### 9. Analytics com eventos definidos
**Objetivo:** medir poucas ações comerciais com significado.

**Eventos mínimos recomendados:**
1. `Lead` — envio válido de interesse/cadastro comercial;
2. `InitiateCheckout` — início real do checkout;
3. `Purchase` — contratação/pagamento confirmado.

**Gate:**
- cada evento deve disparar uma única vez por ação lógica;
- marketing opcional somente após consentimento;
- não enviar dados sensíveis em parâmetros;
- validar no ambiente de teste da plataforma de analytics.

### 10. Open Graph configurado
**Já existente:** title, description, canonical, Open Graph, Twitter Card e dados estruturados no site de captação.

**Gate:**
- testar compartilhamento do domínio final;
- confirmar imagem pública acessível;
- conferir título/descrição sem dados de teste;
- garantir URL canônica final.

### 11. Teste em celular real
**Objetivo:** validar uso fora do redimensionamento do navegador.

**Gate mínimo:**
- iPhone/Safari;
- Android/Chrome;
- login e recuperação de senha;
- telas principais do SST;
- formulários e uploads relevantes;
- PWA/instalação quando aplicável;
- teste com conexão degradada/instável;
- ausência de conteúdo cortado, travamento ou ação inacessível.

## P2 — Melhoria não bloqueante

### 12. llms.txt
Pode ser adicionado como documentação legível por agentes/IA, mas não é mecanismo de SEO e não deve atrasar o lançamento.

## Regra de liberação

### BLOQUEAR publicação quando:
- qualquer P0 estiver sem evidência de validação;
- houver ERROR de segurança não resolvido;
- houver segredo exposto sem rotação;
- backup/restauração não tiver sido comprovado;
- recuperação de acesso/e-mail final não tiver sido testada;
- política legal/LGPD não estiver disponível e revisada.

### LIBERAR publicação quando:
- todos os P0 estiverem `PASS`;
- P1 estiver concluído ou com exceção formalmente documentada e sem risco ao cliente;
- CI/build estiver verde;
- domínio final e integrações de produção estiverem confirmados;
- houver autorização explícita para o go-live.

## Evidência obrigatória do gate

Antes de cada lançamento registrar:
- data da revisão;
- commit/versão revisada;
- ambiente;
- resultado de cada item (`PASS`, `PENDENTE`, `N/A`);
- observação/evidência;
- responsável pela validação;
- decisão final: `LIBERADO` ou `BLOQUEADO`.
