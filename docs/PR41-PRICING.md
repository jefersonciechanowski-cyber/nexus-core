# PR #41 — Racional de precificação da V1

A precificação pública foi revista após a consolidação de certificados, documentos, agenda preventiva, alertas por e-mail, dashboard executivo, controle de EPIs, exames, treinamentos, ocorrências, Central Nexus e cobrança recorrente.

O plano de R$ 149,99 usado no teste do PR #40 permanece preservado no contrato existente e não é reajustado retroativamente.

## Oferta pública proposta

- Essencial — R$ 197/mês — até 50 colaboradores ativos;
- Profissional — R$ 397/mês — até 200 colaboradores ativos;
- Empresarial — R$ 697/mês — até 500 colaboradores ativos;
- Corporativo — acima de 500 colaboradores — proposta personalizada.

## Estratégia

- manter todos os módulos principais nas faixas públicas, reduzindo complexidade comercial;
- diferenciar principalmente pelo volume de colaboradores ativos;
- evitar preço de entrada muito baixo para um produto que já gera certificados, documentação, alertas e rastreabilidade;
- manter espaço para evolução de preço quando entrarem integrações mais avançadas, como eSocial, mídia paga ou automações adicionais;
- preservar preço contratado no momento da venda em `contracted_price_cents`, evitando alteração retroativa quando o catálogo mudar.
