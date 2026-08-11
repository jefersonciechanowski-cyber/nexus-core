# Nexus Core / Nexus SST — Checklist de Produção

Data de referência: 11/08/2026.

Este documento separa claramente o que já está validado no produto, o que permanece em sandbox e o que deve ser alterado somente no momento de colocar clientes reais.

## 1. Estado atual validado

- `main` contém os PRs #41 e #42;
- Supabase principal: `svphwbccqeoakpmcpvhy`;
- RLS e isolamento por organização validados;
- hardening de segurança aplicado pela migration 033;
- Documentação e Fiscalizações aplicadas pelas migrations 034 e 035;
- Stripe Checkout validado em sandbox para cobrança recorrente e anual à vista no boleto;
- Webhook Stripe validado com assinatura e idempotência;
- provisionamento automático validado;
- primeiro acesso e definição de senha validados;
- alertas preventivos e envio por e-mail validados;
- Asaas neutralizado para novas vendas.

## 2. Estado que ainda NÃO é produção financeira

O banco registra as vendas Stripe atuais como `environment = sandbox`.

Não trocar a chave Stripe para `sk_live_...` antes de concluir os itens desta lista. A chave utilizada pela Edge Function determina automaticamente se a venda é registrada como `sandbox` ou `production`.

## 3. Domínio público

### Recomendado para produção

Usar um domínio ou subdomínio próprio, por exemplo:

- `nexus.seudominio.com`
- `app.seudominio.com`

No Cloudflare Workers, vincular o Worker `nexus-core` por **Custom Domain**.

### Endereço temporário atual da main

`https://nexus-core.jefersonciechanowski.workers.dev`

Esse endereço pode continuar servindo para homologação, mas o domínio próprio deve ser o endereço comercial divulgado aos clientes.

Após escolher o domínio definitivo:

1. adicionar o Custom Domain ao Worker `nexus-core`;
2. confirmar HTTPS ativo;
3. definir `NEXUS_PUBLIC_URL` no Supabase com a origem canônica, sem barra final;
4. adicionar a URL em Authentication > URL Configuration no Supabase;
5. testar login, recuperação de senha e primeiro acesso usando somente o domínio definitivo.

## 4. Secrets das Edge Functions

Secrets de produção necessários:

```text
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXUS_PUBLIC_URL=https://dominio-oficial
BREVO_API_KEY=...
BREVO_FROM_EMAIL=acesso@dominio-verificado
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL=alertas@dominio-verificado
```

`SUPABASE_URL`, chaves públicas e chaves administrativas são disponibilizadas pelo ambiente Supabase; chaves administrativas nunca devem ser expostas no frontend.

### Importante

O onboarding comercial usa **Brevo**. Os alertas preventivos do SST usam **Resend**. As duas integrações precisam estar prontas para envio a clientes externos.

## 5. E-mail transacional

### Brevo — primeiro acesso

Validar um remetente/domínio próprio e configurar `BREVO_FROM_EMAIL`.

Exemplo recomendado:

`acesso@dominio-do-nexus.com`

### Resend — alertas preventivos

O remetente de teste não deve ser utilizado como identidade final do produto. Verificar domínio próprio no Resend e configurar:

`RESEND_FROM_EMAIL=alertas@dominio-do-nexus.com`

Preferir subdomínio dedicado para e-mail transacional quando possível.

Após a troca, testar:

- primeiro acesso;
- recuperação de senha;
- alerta de vencimento;
- entrega em Gmail e Outlook;
- Spam/Lixo Eletrônico;
- nome exibido do remetente.

## 6. Stripe Live

### Antes de trocar a chave

No Stripe, ativar os meios de pagamento que serão oferecidos pelo Nexus e confirmar os dados comerciais da conta.

### Endpoint do Webhook

URL:

`https://svphwbccqeoakpmcpvhy.supabase.co/functions/v1/stripe-webhook`

O endpoint precisa receber os eventos usados pelo Nexus:

- `checkout.session.completed`;
- `checkout.session.expired`;
- `checkout.session.async_payment_succeeded`;
- `checkout.session.async_payment_failed`;
- `invoice.paid`;
- `invoice.payment_failed`;
- eventos de atualização/cancelamento da assinatura (`customer.subscription.*`) usados para sincronizar o estado de acesso.

Depois de criar o endpoint **live**, copiar o signing secret `whsec_...` correspondente e salvar como `STRIPE_WEBHOOK_SECRET` no Supabase.

Só então trocar `STRIPE_SECRET_KEY` de `sk_test_...` para `sk_live_...`.

## 7. Regra de teste após ativar Live

Não utilizar e-mails de simulação Stripe (`succeed_immediately`) em produção.

Executar uma contratação real controlada e conferir, nesta ordem:

1. Checkout abre no modo live;
2. cobrança aparece no Dashboard Stripe live;
3. webhook chega com assinatura válida;
4. venda fica `production` no Nexus;
5. empresa e administrador são provisionados;
6. e-mail de primeiro acesso chega pelo remetente de produção;
7. Central Nexus exibe plano e cobrança;
8. Nexus SST abre;
9. cancelar/reembolsar o teste controlado conforme decisão financeira.

## 8. Supabase Auth

Já configurado no produto:

- senha mínima de 8 caracteres.

Pendente por limitação do plano atual:

- proteção contra senhas vazadas (`Leaked password protection`) — requer plano Supabase compatível.

Antes do lançamento, revisar também:

- Site URL;
- Redirect URLs;
- remetentes/templates do Auth, se forem utilizados;
- sessão e recuperação de senha no domínio definitivo.

## 9. Dados de teste

O projeto contém organizações, usuários, vendas e cobranças sandbox usados durante homologação.

Não apagar automaticamente. Antes de limpar:

1. identificar registros de teste;
2. manter histórico técnico necessário;
3. excluir/arquivar somente após autorização explícita;
4. nunca misturar limpeza de sandbox com dados de clientes reais.

## 10. Go-live

O Nexus é considerado pronto para os primeiros clientes quando todos os itens abaixo estiverem concluídos:

- [ ] domínio próprio ligado ao Worker;
- [ ] `NEXUS_PUBLIC_URL` atualizado;
- [ ] URLs do Supabase Auth atualizadas;
- [ ] domínio/remetente Brevo validado;
- [ ] domínio/remetente Resend validado;
- [ ] Stripe live configurado;
- [ ] webhook live configurado e signing secret salvo;
- [ ] pagamento real controlado testado;
- [ ] onboarding real testado;
- [ ] alertas por e-mail testados com remetente final;
- [ ] links públicos finais conferidos;
- [ ] Termos de Uso e Privacidade revisados com os dados comerciais definitivos;
- [ ] manual/e-book do cliente gerado e revisado.

## 11. Depois do go-live

- monitorar erros de Edge Functions e Webhooks;
- acompanhar vendas em `manual_review`;
- acompanhar falhas de entrega de e-mail;
- manter backups/exportações conforme política operacional;
- reavaliar upgrade do Supabase para habilitar proteção de senhas vazadas e ampliar limites conforme crescimento.
