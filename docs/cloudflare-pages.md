# Publicação estática no Cloudflare Pages

O Nexus Core é um site estático e não exige etapa de compilação para publicar
o SST Controle. Esta configuração não substitui nem altera o GitHub Pages.

## Configuração do projeto

Ao criar o projeto no Cloudflare Pages usando a integração com Git, selecione:

- **Production branch:** `main`
- **Build command:** deixe em branco
- **Build output directory:** `.`

Não é necessário criar um arquivo `wrangler.toml`: pela integração com Git, o
diretório de publicação é configurado no painel do Cloudflare e o repositório
permanece independente do provedor.

## Endereços de entrada

- URL base do projeto: `/`
- SST Controle: `/apps/sst-controle/login.html`

O `index.html` da raiz redireciona de forma relativa para o login do SST
Controle. Os scripts, estilos, imagem da marca e redirecionamentos internos do
SST Controle também usam caminhos relativos, portanto funcionam tanto em
`localhost` quanto em um domínio do Cloudflare Pages e continuam compatíveis
com a publicação atual no GitHub Pages.

## Limites desta publicação

O Supabase continua sendo acessado pelo navegador com a configuração já
existente. Nenhuma variável, chave, autenticação ou migração deve ser alterada
ao criar o projeto no Cloudflare Pages.
