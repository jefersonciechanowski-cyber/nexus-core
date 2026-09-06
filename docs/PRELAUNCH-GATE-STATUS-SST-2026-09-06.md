# Nexus SST — Status do Gate Pré-Publicação

Data: 06/09/2026
Branch de trabalho: `security/prelaunch-gate-v2`

## Resumo

| # | Item | Prioridade | Status atual |
|---|---|---|---|
| 1 | Revisão de segurança | P0 | PARCIAL — hardening existente; revisar WARNs do Security Advisor |
| 2 | Secrets fora do repositório | P0 | BOM — scanner reforçado neste PR; manter rotação se houver exposição histórica |
| 3 | Rate limit | P0 | PARCIAL — rate limit público existe; revisar Auth no Dashboard |
| 4 | Monitoramento com alerta | P0 | PENDENTE — definir/configurar canal e testar alerta real |
| 5 | Termos/Privacidade/LGPD | P0 | PARCIAL — páginas existem; falta revisão legal/comercial final |
| 6 | Backup + restauração | P0 | PENDENTE — executar restauração em ambiente isolado |
| 7 | E-mail transacional | P0 | PARCIAL — fluxos existem; falta teste final com remetente/domínio de produção |
| 8 | Search Console/sitemap/robots | P1 | PARCIAL — sitemap/robots existem; confirmar Search Console e noindex privado |
| 9 | Analytics 3 eventos | P1 | PARCIAL — Pixel com consentimento existe; validar Lead/InitiateCheckout/Purchase |
| 10 | Open Graph | P1 | BOM — OG/Twitter/canonical estruturados no site público |
| 11 | Celular real | P1 | PENDENTE — teste formal iPhone + Android + conexão degradada |
| 12 | llms.txt | P2 | IMPLEMENTADO nesta branch |

## Bloqueadores atuais
Enquanto qualquer P0 estiver pendente, o go-live para novos clientes reais deve permanecer bloqueado.

Pendências operacionais acompanhadas na issue #81.
