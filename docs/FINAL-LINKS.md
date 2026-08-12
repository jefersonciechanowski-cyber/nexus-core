# Nexus Core V1 — Mapa de links

Data de referência: 11/08/2026.

## Endereço estável atual da `main`

`https://nexus-core.jefersonciechanowski.workers.dev`

Esse endereço é válido para homologação e pode servir temporariamente a aplicação. Para operação comercial contínua, a referência final deve ser um Custom Domain do Cloudflare.

## Caminhos públicos

Considerando a origem pública do Nexus Core:

- Site comercial: `/`
- Site comercial direto: `/apps/site-captacao/`
- Minha Central Nexus: `/apps/portal-cliente/`
- Login do cliente: `/apps/portal-cliente/login.html`
- Recuperar senha: `/apps/portal-cliente/recuperar-senha.html`
- Nexus SST: `/apps/sst-controle/`
- Central Nexus administrativa: `/apps/nexus-admin/`
- Login administrativo: `/apps/nexus-admin/login.html`
- Política de Privacidade: `/apps/site-captacao/privacidade.html`
- Termos de Uso: `/apps/site-captacao/termos.html`

## Quando o domínio definitivo for conectado

Substituir a origem `workers.dev` pelo domínio oficial em:

1. Cloudflare Worker Custom Domain;
2. secret `NEXUS_PUBLIC_URL` das Edge Functions;
3. Supabase Authentication > URL Configuration;
4. materiais comerciais, e-book/manual e links enviados aos clientes.

Não codificar URLs de branch/preview como endereço oficial do produto.
