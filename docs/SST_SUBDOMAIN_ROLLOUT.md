# Etapa 02: homologação do Nexus SST em subdomínio próprio

**Data:** 23/10/2026
**Status:** preparação e verificação estática — não publicado.
**Controle do lançamento CRM:** https://github.com/nexuscoreindustria-create/nexus-crm/issues/80

## Objetivo

Adicionar `sst.nexuscore.app.br` **ao Worker já existente `nexus-core`**, sem mover arquivos, trocar o host principal, alterar o login do SST em produção ou alterar o CRM. O repositório usa Cloudflare Workers Static Assets em `dist`, produzido por `npm run build:cloudflare`. O `index.html` da raiz continua redirecionando por meta refresh para `apps/site-captacao/`, que atualmente é a vitrine SST.

O domínio principal `nexuscore.app.br` permanece servindo SST até que **todas as integrações, cobrança e autenticação tenham sido testadas no subdomínio**. O layout e a ativação do site institucional são posteriores à homologação dos produtos, por decisão comercial.

## Levantamento

- Painel da conta Cloudflare em 23/10 mostra Worker `nexus-core` ligado ao GitHub `jefersonciechanowski-cyber/nexus-core`, ambiente Production, com dois domínios/rotas exibidos na visão geral; um é `nexuscore.app.br` e outro é o `workers.dev`.
- O código estático tem links relativos para `apps/sst-controle`, `apps/site-captacao` e `apps/portal-cliente`, portanto os caminhos continuam existindo se o mesmo Worker responder no novo hostname.
- `supabase-auth.js` detecta recuperação de senha por caminho, não por hostname; **isso não dispensa testar as URLs e o allowlist de redirecionamentos do Supabase**.
- Vínculos antigos de autenticação, cobrança, e-mails, PWA, URLs canônicas e metadados de SEO podem citar o domínio principal. **Não** substituir a raiz antes de auditar.

## Procedimento Cloudflare (sem deploy de código)

1. No Worker `nexus-core` → **Settings → Domains & Routes** (ou aba Domains conforme UI), verificar os domínios existentes.
2. Na zona `nexuscore.app.br` → **DNS → Records**, confirmar que **não existe CNAME/A/AAAA conflitante para `sst`**. Não apagar `@`, `www`, `crm` ou registros da Central.
3. No mesmo Worker, selecionar **Add → Custom Domain**, nome completo **`sst.nexuscore.app.br`**, confirmar.
4. A Cloudflare cria DNS e certificado TLS automaticamente para domínio personalizado no Worker. **Não inserir um registro A manual nem apontar para Vercel**.
5. Depois da propagação, verificar `https://sst.nexuscore.app.br/`, `/apps/site-captacao/`, `/apps/sst-controle/login.html` e `/apps/portal-cliente/login.html`. Todos devem usar HTTPS.
6. Executar `node scripts/check-sst-domain.mjs` para testes HTTP. O script é **somente leitura**; não faz login nem envio de dados.
7. Testar manualmente em uma conta de homologação: login, logout, recuperação de senha, primeiro acesso, escolha de empresa, permissões, mensagens de bloqueio de assinatura, sessão em celular/PWA e eventuais links de e-mail. Ao entrar em um novo hostname, o navegador poderá requerer **novo login** devido ao armazenamento de sessão por origem.
8. Conferir em Supabase Auth: site URL e **Additional Redirect URLs** para os fluxos legítimos do subdomínio, sem remover os antigos antes da migração. Testar também links enviados pela Central e retorno de checkout; não alterar essas configurações sem testes.
9. Registrar evidências e aprovar o gate. Apenas então discutir quando usar o SST com subdomínio como URL oficial e liberar a raiz para novo site.

## Testes de aceite

- [ ] `sst.nexuscore.app.br` ligado ao **mesmo** Worker `nexus-core`, TLS válido.
- [ ] Página SST e login acessíveis pelo novo hostname.
- [ ] `nexuscore.app.br` e login SST antigo preservados e funcionais.
- [ ] Login/recuperação/primeiro acesso testados com usuário de homologação.
- [ ] Callback/allowlist Supabase e links de e-mail/checkout verificados.
- [ ] Sem erro crítico observado na operação SST depois da associação.
- [ ] Sem alterações no `crm.nexuscore.app.br`, Agency ou produção CRM.
- [ ] Evidências registradas no checklist Nexus CRM (issue #80).

## Reversão

Se o novo host não funcionar, não alterar nem excluir o host principal. Em **Settings → Domains & Routes** do mesmo Worker, desvincular **apenas** o custom domain `sst.nexuscore.app.br`, caso tenha sido criado durante a homologação, e manter `nexuscore.app.br` como antes. Confirmar a raiz e o login legado.

## Regra de publicação

Não usar `main`, não realizar merge nem deploy em produção durante esta preparação. O usuário exige validação por etapa, Preview antes de alterações de código e aprovação antes de produção. Esta documentação pode ser revisada via PR sem ativar qualquer domínio.
