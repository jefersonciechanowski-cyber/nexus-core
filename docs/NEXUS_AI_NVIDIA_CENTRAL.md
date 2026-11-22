# Nexus AI — provedor NVIDIA (Central)

## Escopo
A interface administrativa da Central usa exclusivamente a Edge Function `nexus-ai-core` (Supabase projeto `svphwbccqeoakpmcpvhy`). A função exige usuário autenticado, perfil `nexus_admin` ativo e MFA `aal2` via `is_nexus_admin_aal2`. Perguntas têm limite de 1.200 caracteres, há reserva de consumo por organização/usuário e nenhuma ferramenta executora é exposta ao modelo.

## Modelo selecionado
`nvidia/nemotron-3.5-super-vl-120b-a12b`, pelo endpoint NVIDIA NIM `https://integrate.api.nvidia.com/v1/chat/completions`. Texto e dados *agregados* da Central; nenhuma imagem, áudio, conversa do WhatsApp ou dado pessoal de clientes é enviado automaticamente. Agentes e conectores CRM/Agency/SST ainda são conceituais. Não há fallback para OpenAI, Gemini ou Claude.

## Configuração necessária — produção
A chave `NVIDIA_API_KEY` configurada na Vercel do CRM **não é compartilhada automaticamente** com a Edge Function do Supabase Central. Um administrador deve configurar uma **credencial própria, em segredo de Edge Functions** do projeto `nexus-core-producao` (nunca no GitHub, navegador, log ou chat).

1. No Supabase do projeto Central, configurar o segredo `NVIDIA_API_KEY` via interface de segredos das Edge Functions.
2. Manter `NEXUS_AI_ENABLED` desativado até homologação com textos sintéticos, confirmação de limites/termos de processamento da NVIDIA e configuração de orçamento.
3. Quando autorizado, ativar `NEXUS_AI_ENABLED=true`. Opcionalmente `NEXUS_NVIDIA_MODEL` aceita somente `nvidia/nemotron-3.5-super-vl-120b-a12b`; qualquer outro modelo é negado.
4. Tarifas opcionais `NEXUS_NVIDIA_INPUT_USD_PER_MILLION` e `NEXUS_NVIDIA_OUTPUT_USD_PER_MILLION` somente após confirmação do contrato; sem ambas, custo exato não é estimado (reserva preventiva de cota continua). Não interpretar valores 0 nas tabelas como ausência de cobrança.
5. Na aba Conversa, a interface envia `{operation:'status'}` autenticado antes da primeira pergunta paga. Se a função antiga responder, o cliente **não** chama o provedor. A resposta real deve trazer `provider:'nvidia'` e o modelo autorizado.
6. Validar rejeições 401/403, MFA insuficiente, 503 sem credencial, 429 por limite, resposta com tokens e ausência de ações escritas. Nunca testar enviando dados reais de clientes ao endpoint de prototipagem.

## Política de produção
Os endpoints públicos de teste da NVIDIA têm termos próprios. Antes de enviar dados internos, conferir modalidade/licença e políticas de retenção/privacidade aceitas pela organização. Não guardar API keys, arquivos ou conteúdo integral de perguntas em logs. Limites de tokens, autenticação e auditoria permanecem no servidor Nexus.

## Rollback
O commit anterior em `main` mantém a função com interface antiga, mas fazer rollback **somente com revisão** porque restaurá-la poderia reintroduzir a OpenAI, contrariando a decisão atual. Preferir desabilitar `NEXUS_AI_ENABLED` temporariamente.
