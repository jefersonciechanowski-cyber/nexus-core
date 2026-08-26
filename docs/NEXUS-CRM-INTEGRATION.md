# Nexus CRM na Central Nexus

## Regra de domínio

A Central Nexus é a autoridade comercial do ecossistema.

- Uma empresa contratante existe **uma única vez** como cliente da Central Nexus.
- `Nexus SST` e `Nexus CRM` são produtos contratáveis dessa empresa.
- Os colaboradores cadastrados no SST pertencem à operação do cliente e não viram clientes da Central.
- Leads, contatos, oportunidades e clientes cadastrados dentro do Nexus CRM também pertencem à operação do cliente e não viram clientes da Central.

Exemplo:

```text
Central Nexus
└── Empresa X (1 cliente Nexus)
    ├── Nexus SST
    │   └── colaboradores da Empresa X
    └── Nexus CRM
        └── leads/contatos/clientes da Empresa X
```

## Responsabilidades

### Central Nexus

A Central é dona de:

- cliente/organização contratante;
- catálogo de produtos;
- planos e limites comerciais;
- preço contratado;
- assinatura;
- cobrança e pagamentos;
- situação financeira;
- direito de acesso ao produto;
- provisionamento/sincronização do tenant externo;
- auditoria comercial.

### Nexus CRM

O CRM é dono de:

- workspace/tenant operacional;
- leads;
- contatos;
- clientes do contratante;
- atendimento;
- funis;
- oportunidades;
- propostas;
- atividades e histórico comercial;
- usuários operacionais vinculados ao tenant;
- dados e configurações próprias do CRM.

O CRM não deve criar uma nova `organization` na Central para cada cliente cadastrado dentro dele.

## Produto oficial

Código interno:

```text
crm
```

Nome:

```text
Nexus CRM
```

Modo de provisionamento:

```text
external
```

O CRM possui banco/aplicação próprios. Portanto, o pagamento confirmado na Central cria ou sincroniza um tenant no CRM em vez de copiar os dados operacionais do CRM para o banco do Nexus Core.

## Planos iniciais

| Código | Plano | Mensal | Usuários incluídos |
| --- | --- | ---: | ---: |
| `essencial` | Nexus CRM Essencial | R$ 149 | 3 |
| `profissional` | Nexus CRM Profissional | R$ 349 | 5 |
| `performance` | Nexus CRM Performance | R$ 699 | 10 |

A convenção anual do ecossistema continua sendo 12 meses de acesso pelo equivalente a 10 mensalidades quando a oferta anual à vista estiver habilitada no site comercial.

## Trava de lançamento

O produto é cadastrado inicialmente com:

```text
sales_enabled = false
```

Essa trava é intencional. Não habilitar venda pública antes de concluir todos os itens abaixo:

1. Nexus CRM publicado em URL estável de produção.
2. Endpoint de integração do CRM implantado.
3. Segredo compartilhado Central ↔ CRM configurado somente no servidor.
4. Provisionamento de tenant testado de ponta a ponta.
5. Sincronização de suspensão por inadimplência testada.
6. Sincronização de reativação testada.
7. Mudança de plano/limite de usuários testada.
8. Minha Central abrindo o tenant correto.
9. Checkout e webhook Stripe validados em sandbox.
10. E-mails e textos de onboarding revisados para serem multi-produto.
11. Fluxo público do site CRM validando `sales_enabled` antes de criar checkout.

Somente depois atualizar `launch_url`, `sales_url` e `sales_enabled` do produto `crm`.

## URLs por produto

A Central separa duas URLs:

- `launch_url`: endereço usado para abrir o sistema contratado;
- `sales_url`: endereço da página comercial/renovação.

Para produto externo, `organization_product_access.external_launch_url` pode sobrescrever `launch_url` quando o CRM retornar uma URL específica para o tenant.

Prioridade de abertura da Minha Central:

```text
external_launch_url
→ nexus_products.launch_url
→ nexus_products.app_path
```

## Provisionamento externo

A migration cria `nexus_product_provisioning_jobs`.

Quando um acesso de produto externo se torna elegível, a Central coloca o acesso na fila. Depois de existir tenant, alterações de plano ou direito de acesso também voltam à fila.

O worker é:

```text
supabase/functions/nexus-product-provisioner/index.ts
```

Variáveis necessárias na Central:

```text
NEXUS_PROVISIONER_TOKEN
NEXUS_CRM_PROVISION_URL
NEXUS_CRM_PROVISION_SECRET
```

Nenhuma dessas credenciais pode ir para navegador, HTML público ou repositório com valor real.

## Contrato Central → Nexus CRM

A Central chama `NEXUS_CRM_PROVISION_URL` via `POST`.

Headers:

```http
Content-Type: application/json
Authorization: Bearer <NEXUS_CRM_PROVISION_SECRET>
x-nexus-idempotency-key: <organization_product_access.id>
```

O endpoint do CRM deve ser idempotente pelo `accessId`/`x-nexus-idempotency-key`.

Payload conceitual:

```json
{
  "event": "nexus.subscription.active | nexus.subscription.updated | nexus.subscription.suspended",
  "idempotencyKey": "<access-id>",
  "accessId": "<access-id>",
  "externalTenantId": "<tenant-existente-ou-null>",
  "entitlement": {
    "allowed": true,
    "accessStatus": "active",
    "subscriptionStatus": "active"
  },
  "organization": {
    "centralId": "<organization-id>",
    "name": "Empresa X",
    "legalName": "...",
    "tradeName": "...",
    "registrationNumber": "...",
    "email": "...",
    "phone": "..."
  },
  "owner": {
    "id": "<auth-user-id>",
    "name": "...",
    "email": "..."
  },
  "product": {
    "code": "crm",
    "name": "Nexus CRM"
  },
  "plan": {
    "id": "<plan-id>",
    "code": "profissional",
    "name": "Nexus CRM Profissional",
    "seatLimit": 5
  },
  "subscription": {
    "status": "active",
    "startsAt": "2026-08-26",
    "renewsAt": "2026-09-26",
    "billingMode": "recurring",
    "billingCycleMonths": 1,
    "contractedPriceCents": 34900,
    "currency": "BRL"
  }
}
```

## Resposta esperada do CRM

Para criação inicial:

```json
{
  "tenantId": "<id-do-workspace-no-crm>",
  "launchUrl": "https://crm.exemplo.com/..."
}
```

`tenantId` é obrigatório quando a Central está criando o ambiente pela primeira vez.

Nas sincronizações posteriores, o CRM pode devolver novamente o mesmo `tenantId` e a mesma `launchUrl`. A Central também preserva os valores já conhecidos.

## Comportamento esperado no CRM

### `nexus.subscription.active`

- localizar tenant por `accessId`/`centralId`;
- criar somente se ainda não existir;
- vincular o administrador inicial;
- aplicar plano e limite de usuários;
- deixar o tenant ativo;
- devolver `tenantId` e `launchUrl`.

### `nexus.subscription.updated`

- não criar tenant duplicado;
- atualizar plano e limite de usuários;
- reativar acesso quando `entitlement.allowed = true`;
- preservar dados operacionais existentes.

### `nexus.subscription.suspended`

- preservar tenant e todos os dados;
- bloquear uso normal do CRM enquanto o direito estiver suspenso;
- não excluir leads, contatos, clientes, oportunidades ou histórico;
- permitir reativação futura pelo mesmo tenant.

## Pagamentos

O fluxo comercial esperado é:

```text
Site Nexus CRM
→ Central Nexus
→ Stripe Checkout
→ Stripe Webhook
→ organization_product_access
→ fila de provisionamento/sincronização
→ Nexus CRM
→ Minha Central libera o botão de acesso
```

A confirmação financeira permanece na Central. O CRM recebe somente o direito de uso e os limites necessários para operar.

Uma inadimplência deve produzir:

```text
Stripe
→ Central: subscription_status = past_due
→ Central: access_status = suspended
→ fila externa
→ CRM: entitlement.allowed = false
```

A quitação deve reverter o fluxo sem recriar o tenant.

## Site comercial do CRM

O site do Nexus CRM será um frontend de captação e contratação. Ele não deve possuir sua própria autoridade de cliente/assinatura.

Ele deve solicitar os planos da Central e iniciar a contratação na Central.

O Edge Function atual `nexus-public-sales` foi construído para SST e ainda contém regras específicas de `employee_count`, produto `sst`, piloto SST e textos do Nexus SST. **Não reutilizar esse endpoint sem generalização multi-produto.**

O trabalho do site CRM deve usar um endpoint generalizado ou adaptar esse fluxo explicitamente por `productCode = crm`, respeitando:

- `nexus_products.sales_enabled`;
- `nexus_plans.public_visible`;
- `seat_limit` em vez de `employee_limit`;
- produto/plano vindos da Central, nunca do preço informado pelo navegador;
- Stripe server-side;
- idempotência;
- validação de origem;
- rate limit;
- CNPJ/CPF e dados de cobrança;
- webhooks como fonte final do status financeiro.

## Checklist de publicação

### Central Nexus

- [ ] Revisar esta branch e o diff completo.
- [ ] Aplicar migrations em ambiente controlado.
- [ ] Validar RLS/policies da fila.
- [ ] Implantar `nexus-product-provisioner`.
- [ ] Configurar segredos do provisionador.
- [ ] Configurar execução recorrente/segura do worker ou chamada após eventos.
- [ ] Revisar textos multi-produto do webhook/onboarding.

### Nexus CRM

- [ ] Publicar URL estável.
- [ ] Implementar endpoint `NEXUS_CRM_PROVISION_URL`.
- [ ] Validar segredo Bearer.
- [ ] Implementar idempotência por `accessId`.
- [ ] Criar/upsert do tenant.
- [ ] Aplicar `seatLimit`.
- [ ] Sincronizar ativo/suspenso.
- [ ] Retornar `tenantId` e `launchUrl`.

### Teste ponta a ponta

- [ ] Criar Empresa X na Central.
- [ ] Associar Nexus CRM / plano de sandbox.
- [ ] Confirmar checkout Stripe de teste.
- [ ] Confirmar webhook.
- [ ] Confirmar acesso comercial ativo.
- [ ] Confirmar job de provisionamento.
- [ ] Executar provisionador.
- [ ] Confirmar tenant único no CRM.
- [ ] Confirmar botão de acesso na Minha Central.
- [ ] Cadastrar clientes internos no CRM e confirmar que nenhum novo cliente é criado na Central.
- [ ] Simular inadimplência e confirmar bloqueio sem perda de dados.
- [ ] Reativar pagamento e confirmar retorno do mesmo tenant.
- [ ] Testar upgrade/downgrade de plano e limite de usuários.

### Liberação comercial

Depois de todos os testes, configurar os endereços reais e habilitar vendas:

```sql
update public.nexus_products
set launch_url = 'https://URL-REAL-DO-CRM',
    sales_url = 'https://URL-REAL-DO-SITE-CRM',
    sales_enabled = true,
    updated_at = now()
where code = 'crm';
```

Não executar esse `update` antes da revisão final de produção.
