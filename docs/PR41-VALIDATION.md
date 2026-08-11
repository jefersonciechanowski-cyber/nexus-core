# PR #41 — Roteiro de validação

## Pré-requisitos de ambiente

1. Aplicar migrations 029, 030, 031 e 032.
2. Publicar `nexus-public-sales` sem verificação JWT, pois o site é público.
3. Publicar `stripe-create-checkout` com verificação JWT para cobranças iniciadas por usuários autenticados.
4. Publicar `stripe-webhook` sem verificação JWT do Supabase e validar cada evento pela assinatura `Stripe-Signature` usando `STRIPE_WEBHOOK_SECRET`.
5. Manter `STRIPE_SECRET_KEY` em modo de teste durante toda a validação.
6. Configurar na Stripe o endpoint `https://svphwbccqeoakpmcpvhy.supabase.co/functions/v1/stripe-webhook` com os eventos definidos neste roteiro.
7. Configurar `STRIPE_WEBHOOK_SECRET` diretamente nos Secrets do Supabase.
8. Manter `NEXUS_PUBLIC_URL` apontando para a URL pública adequada; o checkout também registra a origem web validada para retorno e primeiro acesso.
9. Confirmar que `BREVO_API_KEY` e `BREVO_FROM_EMAIL` estão configurados nos Secrets do Supabase e que o remetente está verificado na Brevo.
10. Conferir no Supabase Auth se a URL de redefinição de senha está permitida nos Redirect URLs.

## Eventos Stripe da V1

- `checkout.session.completed`;
- `checkout.session.expired`;
- `checkout.session.async_payment_succeeded`;
- `checkout.session.async_payment_failed`;
- `invoice.paid`;
- `invoice.payment_failed`;
- `customer.subscription.created`;
- `customer.subscription.updated`;
- `customer.subscription.deleted`.

## Fluxo 1 — Lead de demonstração

- abrir o site sem sessão;
- preencher o formulário de demonstração;
- confirmar registro em `nexus_sales` com status `lead` e provider `stripe`;
- confirmar notificação administrativa enviada pela Brevo ao administrador Nexus.

## Fluxo 2 — Compra de cliente novo

Usar e-mail e CPF/CNPJ de teste que ainda não possuam usuário/organização no Nexus.

- selecionar plano público;
- preencher os dados completos;
- abrir Stripe Checkout em modo de teste;
- concluir pagamento com cartão de teste da Stripe;
- confirmar eventos do Webhook sem erro;
- confirmar `nexus_sales.sale_status = provisioned`;
- confirmar criação de `organizations`;
- confirmar criação de usuário Auth + `profiles` como `org_admin`;
- confirmar `organization_product_access` ativo, `billing_provider = stripe` e plano/valor contratados;
- confirmar criação/atualização de checkout e pagamento;
- confirmar e-mail de primeiro acesso enviado pela Brevo com o botão `Definir minha senha`;
- definir senha;
- entrar na Minha Central Nexus;
- acessar o Nexus SST.

## Fluxo 3 — Recuperação de senha

- sair da conta;
- clicar em `Esqueci minha senha`;
- solicitar recuperação;
- confirmar que a tela não revela se um e-mail existe ou não;
- usar o link recebido para definir nova senha;
- testar login novamente.

## Fluxo 4 — Limite do plano

- validar que planos públicos respeitam `employee_limit`;
- confirmar que tentativa de ativar colaborador acima do limite é recusada pelo banco;
- confirmar que o plano legado sem limite explícito não é bloqueado por essa regra.

## Fluxo 5 — Boleto anual

- selecionar a opção anual à vista;
- confirmar que o Checkout apresenta boleto e cobra o equivalente a 10 mensalidades por 12 meses de acesso;
- confirmar que `checkout.session.completed` sem pagamento confirmado não libera o produto;
- simular `checkout.session.async_payment_succeeded` e confirmar provisionamento, e-mail de primeiro acesso e `billing_mode = prepaid`;
- validar `checkout.session.async_payment_failed` sem liberação de acesso.

## Compatibilidade histórica

Os registros de Asaas provenientes do PR #40 permanecem no banco e são identificados pelo provider legado. O PR #41 não depende do Asaas para novas vendas.

## Critério para merge

O PR só deve sair de Draft após os fluxos acima estarem validados e sem erro crítico.
