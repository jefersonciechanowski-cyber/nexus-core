# Nexus CRM — Campanha Black Friday anual, 12 meses por 10

## Condição comercial
- Start: R$ 79/mês → 12 meses por R$ 790 à vista, economia R$ 158.
- Pro: R$ 119/mês → 12 meses por R$ 1.190 à vista, economia R$ 238.
- Gestão: R$ 159/mês → 12 meses por R$ 1.590 à vista, economia R$ 318.
- Desconto efetivo: 2/12 = 16,67%; sem renovação automática ou cobrança mensal durante os 12 meses.
- Preço anual calculado pelo servidor como 10 × plano mensal vigente, nunca informado pelo navegador.
- Preços mensais, produtos, RLS, histórico e demais projetos são preservados.

## Asaas: cobrança anual separada
A API Asaas admite links com `chargeType=DETACHED`, `billingType=PIX|BOLETO`, `value`, `limit=1` e `externalReference`. O construtor puro `crm-asaas-black-friday-annual-contract.mjs` gera exatamente essa operação, com preço validado, sem `subscriptionCycle`, recorrência ou parcelamento.

## Publicação em duas etapas
1. **Etapa disponível**: apresentação da campanha no site CRM aprovado, com preços anuais e botão de solicitação comercial. O checkout mensal segue funcionando via Asaas. Não existe cobrança anual pública neste passo.
2. **Etapa financeira pendente**: `nexus-public-crm-annual-bf-asaas-production` está preparado para criar o link avulso, mas recusa toda requisição até que três chaves INDEPENDENTES estejam explicitamente `true`: `NEXUS_CRM_ASAAS_PROD_ANNUAL_RELEASE_APPROVED`, `NEXUS_CRM_ASAAS_PROD_ANNUAL_SETTLEMENT_READY`, `NEXUS_CRM_ASAAS_PROD_ANNUAL_WORKER_READY`. Não ajustar essas variáveis sem:
   - worker Asaas anual que valida pagamento, link, cliente, CPF/CNPJ e montante com GET de produção;
   - SQL atômico de reserva/claim/lease e lançamento da venda pré-paga com `billing_mode=prepaid`, `billing_cycle_months=12`, valor de 10 mensalidades;
   - provisionamento original seguro: ativação após verificação do pagamento, 12 meses de renovação/expiração, registro do recibo, e-mail de acesso e idempotência;
   - homologação de cancelamento/estorno e expirador do Asaas pré-pago sem tocar em contratos mensais ou de outros produtos;
   - teste ponta a ponta da simulação e, na primeira venda legítima, revisão operacional de webhook e acesso.

**NUNCA** habilitar cobrança anual apenas porque as flags mensais estão prontas: verificador mensal exige `subscription.cycle=MONTHLY` e rejeita cobrança avulsa. Fazer isso receberia dinheiro sem provisionar o CRM.

## Stripe
A Nexus Central possui ao menos um contrato CRM recorrente ativo com Stripe em 08/11/2026. Os novos clientes devem contratar pelo Asaas, mas o contrato Stripe já ativo deve continuar honrado até uma migração expressamente autorizada, reconciliada e sem sobreposição de cobranças. Nunca trocar `billing_provider` diretamente nem apagar subscription Stripe.
