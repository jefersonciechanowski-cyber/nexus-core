# Nexus Central -> Nexus CRM

## Objetivo

A Nexus Central é a fonte comercial de plano, preço, condição contratada e situação de acesso. O Nexus CRM recebe somente um espelho operacional do direito de uso para aplicar limite de usuários e suspensão/cancelamento sem duplicar cobrança dentro do CRM.

## Catálogo inicial do Nexus CRM

| Plano | Preço-base | Usuários incluídos |
| --- | ---: | ---: |
| Start | R$ 79,00/mês | 3 |
| Pro | R$ 119,00/mês | 6 |
| Gestão | R$ 159,00/mês | 10 |
| Personalizado | definido pela Nexus Core | definido no contrato |

Todos os planos mantêm as mesmas funcionalidades e integrações do produto. A diferença comercial inicial é a quantidade de usuários incluídos. Usuários adicionais são armazenados separadamente no contrato.

A condição `founder` é explícita e preserva o preço contratado enquanto a assinatura permanecer ativa. Ela não depende de uma contagem automática de clientes.

## Campos da Central

A migration `20260831173000_nexus_crm_entitlements.sql` adiciona:

- `nexus_products.launch_url`: destino externo opcional do produto;
- `nexus_plans.included_user_limit`: usuários incluídos no plano;
- `organization_product_access.commercial_condition`: `founder` ou `standard`;
- `organization_product_access.additional_users`: assentos extras;
- `organization_product_access.base_user_limit_override`: limite-base definido manualmente quando necessário;
- `organization_product_access.external_tenant_id`: `organization_id` correspondente no Nexus CRM.

A função SQL `configure_crm_product_access(...)` permite ao Nexus Admin criar ou atualizar o contrato do CRM sem escrever diretamente os campos de integração.

## Sincronização

A Edge Function `nexus-crm-entitlement-sync`:

1. exige sessão de usuário `nexus_admin`;
2. lê o contrato e o plano na Central;
3. valida o `external_tenant_id` do CRM;
4. monta o snapshot de entitlement;
5. assina o JSON com HMAC SHA-256 usando `NEXUS_CENTRAL_WEBHOOK_SECRET`;
6. envia o evento ao endpoint configurado em `NEXUS_CRM_ENTITLEMENT_URL`.

O segredo HMAC nunca deve ser exposto no navegador ou versionado no GitHub.

## Mapeamento de status

- `subscription_status = cancelled` -> `cancelled` no CRM;
- `access_status = suspended` ou `subscription_status = past_due` -> `suspended` no CRM;
- demais contratos válidos -> `active` no CRM.

Eventos aceitos pelo CRM:

- `entitlement.activated`;
- `entitlement.suspended`;
- `entitlement.reactivated`;
- `entitlement.cancelled`;
- `plan.changed`.

## Variáveis de backend

Na Central Nexus / Supabase Edge Functions:

```text
NEXUS_CRM_ENTITLEMENT_URL=https://<projeto-crm>.supabase.co/functions/v1/nexus-central-entitlement
NEXUS_CENTRAL_WEBHOOK_SECRET=<mesmo segredo forte configurado no CRM>
```

O `NEXUS_CENTRAL_WEBHOOK_SECRET` deve ter pelo menos 32 caracteres.

## Fluxo de ativação

1. Aplicar a migration na Central Nexus.
2. Publicar `nexus-crm-entitlement-sync`.
3. Configurar as duas variáveis de backend.
4. Criar/selecionar a empresa pagadora na Central.
5. Configurar o contrato com `configure_crm_product_access(...)`, informando o `organization_id` do CRM.
6. Invocar `nexus-crm-entitlement-sync` com o `accessId` retornado.
7. Conferir no CRM se plano, condição comercial, preço e limite de usuários foram atualizados.

## Pendente após o primeiro teste ponta a ponta

- ligar a sincronização aos eventos automáticos de pagamento/checkout da Central;
- expor os campos específicos do CRM na interface administrativa, evitando SQL manual;
- substituir o launcher temporário pela URL canônica `crm.nexuscore.app.br` quando o domínio estiver publicado;
- remover o entitlement manual de teste do CRM depois que a Central assumir a Stone Company.
