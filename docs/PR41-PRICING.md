# PR #41 — Racional de precificação da V1

A precificação pública foi revista após a consolidação de certificados, documentos, agenda preventiva, alertas por e-mail, dashboard executivo, controle de EPIs, exames, treinamentos, ocorrências, Central Nexus e cobrança recorrente.

O plano de R$ 149,99 usado no teste do PR #40 permanece preservado no contrato existente e não é reajustado retroativamente.

## Oferta pública definida

- Essencial — R$ 97/mês — até 50 colaboradores ativos;
- Profissional — R$ 197/mês — até 100 colaboradores ativos;
- Empresarial — R$ 297/mês — até 250 colaboradores ativos;
- Corporativo — acima de 250 colaboradores — proposta personalizada.

## Estratégia

- manter todos os módulos principais nas faixas públicas, reduzindo complexidade comercial;
- diferenciar principalmente pelo volume de colaboradores ativos;
- usar o Essencial como porta de entrada para pequenas operações, com valor acessível sem remover os módulos centrais da V1;
- ampliar capacidade e ticket no Profissional para operações de até 100 colaboradores;
- usar o Empresarial como próxima faixa paga para operações de até 250 colaboradores;
- direcionar operações acima de 250 colaboradores para proposta personalizada;
- preservar o preço contratado no momento da venda em `contracted_price_cents`, evitando alteração retroativa quando o catálogo mudar.

Esta precificação é a referência comercial registrada para o fechamento funcional do PR #41 e pode ser revisada futuramente sem alterar contratos já existentes.
