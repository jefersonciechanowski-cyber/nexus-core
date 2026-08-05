# Arquitetura Nexus Core

## Estrutura
- `apps/sst-controle`: produto atual e acesso de demonstração.
- `apps/site-captacao`: próxima etapa, landing page e captação.
- `apps/portal-cliente`: acesso unificado aos produtos Nexus.
- `apps/nexus-admin`: administração interna, clientes, planos e pagamentos.
- `packages/ui`: futuro design system compartilhado.
- `supabase`: banco, autenticação, RLS e migrações.

## Regra de domínio central
A Matriz de Controle vincula setor e função aos exames, treinamentos, EPIs, documentos e riscos obrigatórios. A vida útil do EPI pertence à regra da Matriz para o setor/função, nunca ao cadastro global do EPI.

## Ordem aprovada
1. Demonstração com autenticação local.
2. Publicação para testes.
3. Site de captação.
4. Supabase, autenticação real e multi-tenant.
5. Pagamentos e liberação de assinatura.
6. Portal do Cliente.
7. Nexus Admin.
