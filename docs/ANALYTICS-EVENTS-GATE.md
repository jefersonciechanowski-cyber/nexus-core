# Nexus Core / Nexus SST — Analytics: Eventos Mínimos de Lançamento

## Objetivo
Medir somente ações comerciais que apoiam decisões, sem enviar dados pessoais sensíveis para plataformas de marketing.

## Eventos mínimos

### 1. Lead
Disparar somente depois de um envio comercial válido aceito pelo backend.

Não enviar:
- CPF/CNPJ completo como parâmetro de marketing;
- telefone/e-mail em texto puro;
- dados de saúde/SST;
- conteúdo livre de formulários.

### 2. InitiateCheckout
Disparar quando o usuário realmente iniciar a jornada de checkout para um plano selecionado.

Parâmetros permitidos devem ser mínimos, por exemplo:
- identificador público do plano;
- moeda;
- valor comercial quando aplicável e permitido.

### 3. Purchase
Disparar apenas após confirmação confiável da contratação/pagamento no backend/webhook. Não considerar simples redirecionamento de navegador como confirmação de compra.

## Consentimento
Eventos de marketing opcionais só podem ser enviados quando o consentimento correspondente estiver concedido. O site já possui mecanismo para impedir inicialização do Meta Pixel antes do consentimento.

## Gate de validação
- [ ] `Lead` validado no ambiente de teste;
- [ ] `InitiateCheckout` validado no ambiente de teste;
- [ ] `Purchase` validado a partir de confirmação backend/webhook;
- [ ] sem duplicidade em refresh/reenvio;
- [ ] nenhum dado sensível nos parâmetros;
- [ ] comportamento com consentimento negado validado.
