# Nexus CRM — prontidão técnica antes do primeiro cliente

Estado: lançamento técnico em preparação, **nenhum cliente novo necessário para finalizar software**.

## Mudança
As funções de checkout mensal Asaas, verificação, provisionamento, renovação e despacho antes tinham `HARD OFF` permanente em código. Agora continuam **OFF por padrão** e só permitem execução com `NEXUS_CRM_ASAAS_PROD_RELEASE_APPROVED=true`, além das flags, credenciais exclusivas e garantias financeiras já exigidas por cada função.

Esta versão não ativa uma cobrança, não cria empresa e não aprova homologação financeira sem as demais verificações.

## Diagnóstico sem pagamento
O job GitHub de monitoramento, autenticado por OIDC, solicita `{"action":"readiness"}` ao dispatcher. A resposta traz **somente nomes de flags e credenciais ausentes**, estado da publicação dos planos e configuração do webhook Asaas, consultado por GET da própria conta. Não mostra tokens, CPF/CNPJ, clientes, valores de transações nem invoca POST no provedor.

As três mensalidades CRM Start/Pro/Gestão devem estar publicáveis no banco; `public_visible=false` impede checkout mesmo com uma ponte assinada. Somente tornar os planos públicos **depois** de todo o fluxo habilitado.

## Passos finais para pronto para primeiro cliente
1. CI e testes integrados de checkout → evento Asaas simulado → quatro consultas independentes → reserva/claim/lease PostgreSQL → provisionamento do mesmo tenant → e-mail e entitlement → renovação idempotente, usando fixtures/Sandbox, sem cobrança real.
2. Validar chave Asaas produção, token dedicado do webhook e existência/configuração do webhook no provedor por GET. Configuração correta antes da primeira entrega basta para liberar o produto *com monitoramento*; o primeiro evento real é confirmação **pós-lançamento**, não bloqueio circular do trabalho de engenharia.
3. Configurar no Supabase Central, de maneira segura, segredos exclusivos (webhook, checkout bridge, worker de provisionamento, worker de renovação, verificador), sem usar secret do CRM de outro projeto. Confirmar igualdade da chave de ponte com o segredo exclusivo no Vercel CRM Production; não colocar em `NEXT_PUBLIC_`.
4. Habilitar recepção autenticada e verificações isoladas. Validar endpoint somente leitura, filas, ações administrativas, outbox e rollback.
5. Abrir os planos públicos e as flags gradualmente. A última alteração é `NEXUS_CRM_ASAAS_PROD_RELEASE_APPROVED=true` com todas as outras conferidas e `NEXUS_CRM_ASAAS_PROD_FINANCIAL_WORKFLOW_ENABLED=true` no GitHub. A configuração Vercel `NEXUS_CRM_ASAAS_PUBLIC_CHECKOUT_ENABLED=true` exige novo deploy para disponibilizar a rota.
6. A primeira compra legítima deve gerar alerta/monitoramento de evento e provisionamento; ela valida operação real, mas **não exige cliente artificial ou pagamento do administrador**.
7. Cobranças Pix/boleto são faturas mensais que o cliente precisa pagar; não representam débito Pix Automático. Inadimplência tem carência aprovada de 7 dias e deve respeitar notificação, pagamentos fora de ordem e revisão de cancelamentos/estornos.

## Contenção e rollback
Desligar checkout público no Vercel e `NEXUS_CRM_ASAAS_PROD_CHECKOUT_ENABLED` na Central para impedir **novas** contratações, mas manter o recebimento de webhooks, renovação de clientes existentes e a reconciliação sob controle. Não suspender indiscriminadamente acessos já pagos. Monitorar filas `pending/manual_review` e erros de envio de e-mail.

## Condição de aceite técnico
Sem flags faltantes, sem segredos ausentes, planos públicos, webhook da conta Asaas habilitado e configurado, banco e filas coerentes, worker protegido validado com Sandbox e retries, CI aprovado e domínio CRM publicado. `providerDeliveryVerified=false` permanece até a primeira entrega autêntica: isso deve ser explicitamente rotulado como verificação pós-lançamento, nunca simulada como real.
