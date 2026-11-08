# Nexus CRM — captação de interessados a partir de anúncios (sem cobrança)

Status: preparado para captar interessados para contratação assistida.
Este fluxo **não** substitui o checkout mensal nem inicia uma assinatura.
Produto: Nexus CRM; sem impacto no SST Controle ou Nexus Agency.

## Página de anúncios
URL: https://nexuscore.app.br/crm/#contato

Os cartões Start (R$79/mês), Pro (R$119/mês) e Gestão (R$159/mês)
selecionam o plano no formulário, sem exigir CPF, CNPJ ou pagamento.

O formulário solicita empresa, responsável e WhatsApp com DDD, permite
e-mail e plano opcionais e exige concordância com a Política de
Privacidade. A URL aceita `utm_source`, `utm_medium`,
`utm_campaign`, `utm_content` e `utm_term`; a aplicação registra
origem, campanha e criativo no lead.

## Integração financeira SEPARADA
O endpoint `nexus-public-crm-interest` recebe exclusivamente contatos
que autorizam retorno comercial. Grava `sale_status='lead'` e
`lead_stage='new'` na tabela existente `nexus_sales` da Nexus Central,
associada ao produto CRM e ao plano escolhido. **Não grava ID de
pagamento, cria link, dispara webhook, usuário ou CRM.**

A coluna `provider='asaas'` é um valor obrigatório pelo contrato do
banco para leads CRM. Ela NÃO indica cobrança ou confirmação financeira;
somente `sale_status` e as evidências financeiras autorizam ativação.

O endpoint:
- exige `Origin` exata `https://nexuscore.app.br`;
- aceita somente `POST` JSON e CORS preflight `OPTIONS`;
- rejeita corpo acima de 4KiB, limites incoerentes e dados sem
  consentimento, e possui honeypot antispam;
- aplica rate limit por contato, sem armazenar telefone no limitador;
- evita inserir novamente o mesmo telefone em lead CRM nas últimas
  24 horas;
- limita planos ao CRM e preserva RLS na tabela de vendas;
- não devolve dados pessoais, IDs de clientes ou segredos ao navegador.

Os registros podem ser acompanhados na Nexus Central, na gestão de
vendas/leads existentes (filtro de produto CRM, status `lead`).

## Homologação sem custos
Os testes automatizados verificam validação, privacidade, rastreamento,
fluxo sem cobrança, origem e a preservação do checkout Asaas **HARD OFF**.
A produção pode ser verificada via pré-voo `OPTIONS` e tentativa
`POST` com corpo inválido, sem inserir um contato real.

Não inserir leads fictícios em produção. O primeiro formulário legítimo
será acompanhado na Nexus Central após começar a campanha.

## Antes de ativar anúncios pagos
- Conferir site, formulário e gravação de interesse; aprovar orçamento
  da campanha e objetivo de conversão **lead/demonstração**, não
  checkout pago automático.
- Não prometer ativação instantânea nem compra autosserviço até
  resolver o checkout/provisionador financeiro.
- Confirmar canal de acompanhamento e tempo de resposta humano para
  não perder interessados.

## Pendente para faturamento self-service
Ligação confiável checkout público assinado -> webhook produção ->
reserva idempotente -> confirmação na API Asaas -> provisionamento ->
e-mail -> acesso -> renovação; primeira entrega real do webhook e
primeira contratação legítima permanecem pendentes.
