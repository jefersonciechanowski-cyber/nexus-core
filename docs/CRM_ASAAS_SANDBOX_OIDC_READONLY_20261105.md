# Nexus Central — verificação Asaas Sandbox sem rotação de segredo

**Data:** 05/11/2026. **Escopo:** somente Nexus Central, sem alterar Central Auth, CRM, Agency, SST ou contratos. **Sem cobrança.**

O segredo `NEXUS_CRM_ASAAS_VERIFY_SECRET` já está salvo no Supabase, mas seu valor não é recuperável via conector. Não redefinir nem pedir que o usuário o copie.

## Execução técnica

Uma função isolada e temporária `nexus-crm-asaas-readonly-once`:

- aceita apenas um JWT OIDC do GitHub Actions verificado contra JWKS oficial, para o repositório, workflow e branch `main` exatos;
- responde `401/403` a chamadas sem a identidade exigida;
- termina automaticamente com `410` após 09/11/2026 UTC;
- aceita apenas corpo `{}` e consulta somente o evento Sandbox já registrado do pagamento fictício de R$ 79;
- lê a chave atual internamente e chama **somente** `nexus-crm-asaas-verify-event` com `{"reserve":false}`; esta função já usa GET autenticado do Asaas Sandbox;
- não lê service_role, não consulta ou altera banco, não reserva pagamento, não cria usuário, empresa, cobrança, e-mail ou contrato;
- devolve exclusivamente `decision`, `reason`, `canActivateCrm:false`, `readOnly:true`, nunca chaves, documento, dados de cliente ou respostas brutas.

O workflow `.github/workflows/crm-asaas-sandbox-readonly.yml` executa **uma única vez na inclusão em main** (gatilho push filtrado para seu próprio arquivo). Sua identidade é OIDC efêmera e distinta da reconciliação Stripe. Em caso de erro, o job falha fechado e imprime somente códigos de decisão.

### Gate de publicação

1. PR revisado, teste Node específico + CI Security com SQL isolado aprovados.
2. Publicar **apenas a nova Edge Function** em `svphwbccqeoakpmcpvhy`, `verify_jwt=false` pois o OIDC externo é validado obrigatoriamente pelo próprio handler.
3. Mergear PR em `main` e observar o workflow.
4. Interpretar `verified_for_review` como **consulta independente aprovada**, não como autorização de provisionar/ativar checkout.
5. Não mudar `NEXUS_CRM_ASAAS_VERIFY_SECRET` ou flags financeiras; não tocar outros projetos.
6. Após o ensaio, aposentar o wrapper com HTTP 410 e encerrar o workflow, conservando o resultado no histórico do Actions.

A execução prova leitura real no provedor, **não** testa envio do e-mail e primeiro login do cliente fictício. Ambas as entregas têm gates próprios.
