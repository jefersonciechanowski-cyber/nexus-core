# Nexus Core / Nexus SST — Gate de Monitoramento de Erros

## Objetivo
Garantir que falhas críticas sejam percebidas pela equipe antes de depender do relato do cliente.

## Cobertura mínima
- erros 5xx em endpoints públicos e privados;
- falhas de Edge Functions;
- falhas de webhooks Stripe/Asaas;
- falhas de onboarding/provisionamento;
- falhas de envio de e-mail;
- exceções críticas do frontend quando houver ferramenta de captura configurada.

## Requisitos
- alerta deve chegar por um canal operacional definido;
- logs não podem conter senha, token, segredo, cookie de sessão ou payload sensível desnecessário;
- erros devem ter timestamp, componente/rota, ambiente e identificador técnico de correlação quando possível;
- alertas repetidos devem ser agregados para evitar ruído excessivo.

## Teste obrigatório
1. provocar uma falha controlada em ambiente de homologação;
2. confirmar registro do erro;
3. confirmar recebimento do alerta;
4. confirmar que o alerta não contém segredo/dado sensível;
5. registrar data e evidência;
6. marcar PASS somente depois do recebimento real.

## Status
Este documento define o gate. A ferramenta/canal de alerta de produção deve ser configurado e testado antes do go-live comercial.
