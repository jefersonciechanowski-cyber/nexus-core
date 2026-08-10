# PR #41 — Roteiro de validação

## Pré-requisitos de ambiente

1. Aplicar migrations 029 e 030.
2. Publicar `nexus-public-sales` sem verificação JWT, pois o site é público.
3. Republicar `asaas-webhook` com a versão do PR #41 e manter a validação pelo `ASAAS_WEBHOOK_TOKEN`.
4. Manter `ASAAS_API_KEY` no Sandbox durante a validação.
5. Configurar `NEXUS_PUBLIC_URL` para a URL do preview durante o teste e, após o merge, para o domínio público definitivo.
6. Confirmar que `RESEND_API_KEY` e `RESEND_FROM_EMAIL` continuam configurados.
7. Conferir no Supabase Auth se a URL de redefinição de senha está permitida nos Redirect URLs.

## Fluxo 1 — Lead de demonstração

- abrir o site sem sessão;
- preencher o formulário de demonstração;
- confirmar registro em `nexus_sales` com status `lead`;
- confirmar notificação enviada ao administrador Nexus.

## Fluxo 2 — Compra de cliente novo

Usar e-mail e CPF/CNPJ que ainda não possuam usuário/organização no Nexus.

- selecionar plano público;
- preencher os dados completos;
- abrir checkout Asaas Sandbox;
- concluir pagamento com cartão de teste;
- confirmar eventos do Webhook sem erro;
- confirmar `nexus_sales.sale_status = provisioned`;
- confirmar criação de `organizations`;
- confirmar criação de usuário Auth + `profiles` como `org_admin`;
- confirmar `organization_product_access` ativo e com plano/valor contratados;
- confirmar criação/atualização de checkout e pagamento;
- confirmar e-mail de primeiro acesso;
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

## Critério para merge

O PR só deve sair de Draft após os quatro fluxos acima estarem validados e sem erro crítico.
