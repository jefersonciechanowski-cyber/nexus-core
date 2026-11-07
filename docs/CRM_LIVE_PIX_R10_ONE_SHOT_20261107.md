# Nexus CRM — teste financeiro REAL Pix R$10 (único, sem assinatura)

Data: 07/11/2026. Projeto: Nexus Central `jefersonciechanowski-cyber/nexus-core`. CRM permanece tecnicamente separado.

## Objetivo
Validar numa conta própria e com e-mail/CPF diferentes dos já usados na Nexus:
1. cadastro de um pagador real no Asaas **Produção**;
2. **uma** cobrança Pix avulsa de R$10 (sem assinatura, sem recorrência);
3. comprovação do recebimento via GET autenticado no Asaas Produção;
4. vínculo financeiro único na Nexus Central;
5. provisionamento administrativo pago **não-cortesia**, com novo tenant no CRM;
6. envio privado do primeiro acesso e login real do próprio titular.

O pagamento é real, pode gerar taxas e não é simulação. O operador deve confirmar o recebedor na fatura antes de pagar. CPF válido deve ser informado apenas na página privada da Central, **nunca neste chat**.

## Segurança obrigatória — gates antes de cobrar

- A implementação proposta começa com `STAGED_LIVE_PIX_DISABLED = true`. **Nunca habilitar via commit nem publicar essa mudança sem CI verde, revisão de segurança e aceite específico de uma cobrança real.**
- A nova Edge Function `nexus-admin-crm-live-pix-pilot` requer usuário `nexus_admin` ativo **e AAL2/MFA**, aceita somente Origins oficiais da Nexus e POST com JSON limitado.
- Duas flags separadas, inicialmente não configuradas: `NEXUS_CRM_LIVE_PIX_PILOT_ENABLED` e `NEXUS_CRM_LIVE_PIX_PILOT_CHARGE_ENABLED`. Ambas devem ser `true` em Supabase **somente quando houver autorização para o teste**. As flags globais de comercialização pública, `NEXUS_PAYMENT_LIVE_ENABLED`, checkout e Asaas Sandbox não devem ser alteradas para este piloto.
- Credencial exclusiva da produção Asaas: `ASAAS_PRODUCTION_API_KEY`, inserida **somente** no Supabase Secrets do projeto Central. Nunca usar chave Sandbox, nunca enviar por chat, prints ou Git. API fixa `https://api.asaas.com/v3`; cabeçalho `access_token` server-side.
- Migração `20261107110000_crm_live_pix_ten_real_pilot.sql` deve ser revisada e aplicada primeiro. Cria tabela de piloto **server-only** com RLS sem políticas de leitura de navegador, revogação de grants e campo `slot=1` único. Não aplicar sem revisão dos dados/esquema e rollback.
- O formulário solicita confirmação da contratação e botão distinto de aprovação da **cobrança real**.
- A criação da cobrança reserva o único slot com UPDATE condicional; em timeout de cliente/cobrança, a operação entra em `manual_review` e **nunca é tentada de novo automaticamente**. Reconciliação de ocorrência desconhecida deve ser feita no Asaas pelo `externalReference`, antes de decidir sobre qualquer outra operação.
- Valores são fixos em backend: `PIX`, `R$10,00`, sem campo `subscription` ou parcelamento. O catálogo não é editado. URL de fatura aceita somente domínio oficial Asaas.
- A verificação de Pix consulta a cobrança e o cliente no Asaas Produção, conferindo `id`, `externalReference`, `customer`, CPF, `billingType`, R$10 e status **RECEIVED**. `PENDING` e `CONFIRMED` ainda não liberam acesso; `REFUNDED`, chargebacks e assinaturas são recusados. Webhook sozinho nunca libera tenant.
- O registro `nexus_payments` usa `provider='asaas'`, `billing_type='PIX'` e identificador Asaas exclusivo; o contrato do cliente usa `commercial_condition='standard'` e `billing_mode='prepaid'`, **não cortesia nem assinatura**. Vigência de um mês com verificação administrativa de término.
- A ativação usa `provisionCrmTenant(...,'administrative')` já existente, empresa nova sem reaproveitar usuário de outro tenant. O link de primeiro acesso não é persistido; caso a Brevo esteja configurada, é enviado para o novo e-mail informado. Se o e-mail não chegar, o administrador autorizado verá o link uma única vez, somente para uso pelo titular.

## Evidências necessárias para considerar o teste aprovado

- [ ] Branch revisada, CI de segurança aprovado, migração aplicada e Edge Function `ACTIVE` confirmada com gates ainda OFF.
- [ ] Operador confirmou que a chave de produção está disponível **no servidor** (sem revelar seu valor).
- [ ] Operador revisou o recebedor/conta bancária do Asaas e autorizou a **única** cobrança em produção.
- [ ] Asaas retornou `pay_...` único e valor R$10, PIX, sem assinatura.
- [ ] Extrato financeiro confirma `RECEIVED`, sem reembolso nem chargeback.
- [ ] Nexus Central contém pagamento único e contrato pré-pago com o novo tenant vinculado e sem duplicata.
- [ ] CRM criou organização separada, usuário inicial e pipeline. Responsável abriu o e-mail ou link, definiu senha e fez login.
- [ ] Responsável Nexus conferiu acesso, vigência e procedimento de suspensão manual; contrato de teste não será renovado automaticamente.
- [ ] Após o teste, **desabilitar as duas flags do piloto** e manter o checkout público desativado.

## Regras de interrupção

- Falha na gravação do ID da cobrança, timeout desconhecido, divergência de CPF, valor, pagador, provider/status ou colisão de identidade: **manual_review** e nenhuma repetição automática.
- Falha de provisionamento: pagamento real não é refeito; recuperação depende do mesmo registro e auditoria. Não rodar SQL de `paid`, não criar cortesia como atalho.
- Interromper se houver dúvida sobre taxas, titularidade da conta Asaas, emissão de documentos fiscais ou vencimento. O resultado desse teste **não libera venda recorrente para clientes externos** nem prova o ciclo completo de cobrança de cartões Stripe e Asaas.
- Não implantar produção sem revisão de `SECURITY.md`, checkouts públicos OFF e aprovação específica do usuário.
