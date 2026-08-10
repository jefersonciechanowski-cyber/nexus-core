# PR #41 — Fechamento comercial e onboarding automático

Este PR fecha o ciclo comercial da V1 sem alterar retroativamente o contrato e o histórico financeiro usados nos testes anteriores.

## Incluído

- site comercial orientado a venda e prospecção fria;
- planos públicos e faixa de colaboradores;
- lead de demonstração persistido no Supabase;
- checkout público recorrente via Stripe;
- checkout Stripe para assinaturas iniciadas na Minha Central;
- Webhook Stripe com verificação criptográfica e idempotência;
- provisionamento automático após confirmação financeira;
- criação de empresa, administrador e acesso ao Nexus SST;
- e-mail de primeiro acesso;
- recuperação e redefinição de senha;
- páginas iniciais de privacidade e termos;
- raiz do deploy abrindo o site comercial;
- limite de colaboradores ativos aplicado no banco conforme o plano;
- camada financeira preparada para `stripe` e histórico `asaas` sem apagar registros anteriores;
- documentação de fechamento da V1 e plano de auditoria de segurança.

## Não incluído

- ativação da Stripe em modo real antes da validação completa do modo de teste;
- Pix recorrente;
- migração forçada de assinaturas históricas do Asaas;
- integração com Meta Ads ou Google Ads;
- eSocial/PGR automático;
- revisão jurídica definitiva dos documentos legais;
- auditoria de segurança final, que está registrada como próxima etapa obrigatória.
