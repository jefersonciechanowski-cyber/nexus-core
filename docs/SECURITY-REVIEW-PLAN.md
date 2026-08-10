# Plano de revisão de segurança — Nexus Core V1

Este documento registra a revisão de segurança que deve ocorrer após o fechamento funcional da V1 e antes de ampliar a operação comercial.

## Escopo obrigatório

- Supabase Auth: login, recuperação de senha, criação de usuários, encerramento de sessão e proteção contra enumeração de contas.
- RLS e GRANTs: revisar todas as tabelas multiempresa, políticas de leitura/escrita, `service_role` e funções `security definer`.
- Edge Functions: validar autenticação, `verify_jwt`, CORS, validação de entrada, rate limit, idempotência e tratamento de erros.
- Asaas: confirmar segregação Sandbox/Produção, proteção de API Key, token exclusivo de Webhook, idempotência e conciliação financeira.
- Resend: verificar remetente, exposição de endereços, links de primeiro acesso e recuperação.
- Site público: revisar formulários, spam/abuso, XSS, links externos, política de privacidade e termos.
- Storage: conferir buckets privados, políticas de logos/documentos e URLs assinadas.
- Front-end: procurar segredos, dados simulados, IDs sensíveis, uso inseguro de `innerHTML`, dependências CDN e headers de segurança.
- Cloudflare: CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, cache e proteção de rotas administrativas.
- Auditoria: validar logs de documentos, pagamentos, onboarding, alterações críticas e eventos de segurança.
- Dependências: revisar versões, vulnerabilidades conhecidas e bibliotecas sem necessidade.

## Testes mínimos

1. Tentar acessar dados de outra organização com usuário comum.
2. Tentar escrever em tabelas administrativas usando chave pública.
3. Repetir Webhooks e confirmar idempotência.
4. Testar checkout público com payloads inválidos e excesso de tentativas.
5. Testar recuperação de senha com e-mail existente e inexistente sem revelar cadastro.
6. Confirmar que nenhum segredo aparece no HTML, JavaScript, logs públicos ou repositório.
7. Revisar os principais riscos do OWASP Top 10 aplicáveis ao produto.

## Regra de lançamento

Nenhum achado crítico ou alto deve permanecer aberto antes de considerar a V1 pronta para operação comercial em produção.
