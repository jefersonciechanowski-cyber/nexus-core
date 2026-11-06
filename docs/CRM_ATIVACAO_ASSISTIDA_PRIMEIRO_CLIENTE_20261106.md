# Nexus CRM — ativação assistida do primeiro cliente

**Revisão:** 06/11/2026 · **Responsável operacional:** administração Nexus · **Escopo:** somente Nexus Central + Nexus CRM. Não alterar Nexus Agency/SST.

## Situação verificada no ambiente atual

- O Nexus CRM está publicado em `crm.nexuscore.app.br`. A página comercial mantém **solicitação de contratação por e-mail** para os planos enquanto o checkout público permanecer desativado.
- Na Nexus Central, `apps/nexus-admin/crm-access.html` possui **Cliente Cortesia** e controle de acesso ao CRM. O backend `nexus-admin-crm-courtesy` está **ACTIVE**, exige usuário `nexus_admin` ativo e sessão MFA **AAL2** antes do cadastro. O destino `nexus-central-provision` do CRM também está **ACTIVE**.
- O provisionador administrativo existente cria/vincula empresa e responsável no CRM, prepara funil inicial e devolve `firstAccessUrl` quando há primeiro acesso.
- Em 06/11/2026, seis contratos CRM tinham tenant vinculado na Central; quatro eram cortesia, nenhum vencido na data da verificação. Isso comprova registros, **não** uma entrega de acesso nova.
- **Contrato de cortesia não representa pagamento.** O backend registra preço `0`, `commercial_condition='courtesy'`, sem provedor de cobrança. Os bancos financeiros atuais só permitem provedores `stripe` ou `asaas`; não há fluxo homologado para registrar um pagamento manual como assinatura ativa. Nunca alterar valores ou marcar `paid` por SQL.
- O Asaas Sandbox foi investigado. O último piloto devolveu HTTP 409; não houve nova venda. Não repetir checkout nem ativar flags financeiras para usar a modalidade assistida.

## Rota A: primeiro cliente em cortesia — já implementada

Use **somente** quando uma cortesia gratuita for aprovada e explicada ao cliente; não apresentar como assinatura paga.

1. Confirmar autorização do cliente, identificação da empresa, nome do responsável e **e-mail sob controle dele**. Verificar duplicidade de empresa, e-mail, vínculo Central e CRM. Nunca usar um e-mail de cliente diferente para reaproveitar tenant.
2. Entrar no **Nexus Admin → Controle do Nexus CRM → Cliente Cortesia**, em sessão administrativa com MFA2. Escolher um plano CRM e, para o primeiro piloto, prazo de **1 mês** (recomendação operacional, não regra de código).
3. Confirmar a intenção de criar cortesia **R$ 0**, sem pagamento, e executar uma única vez. Se falhar, usar os mesmos dados no retry autorizado; não criar outro cliente por tentativa.
4. Confirmar retorno `ok` e `crmOrganizationId`; se `alreadyProvisioned`, não tentar criar novo tenant. Conferir na Central a condição cortesia, vigência `renews_at` e `external_tenant_id`. Conferir no CRM o mesmo vínculo de empresa, contrato e limites do plano.
5. O `firstAccessUrl` é **credencial de acesso temporária**. Transmitir somente ao e-mail validado do responsável por canal privado apropriado; nunca colocá-lo em issue, print, logs, chat ou documento do GitHub. Se não houver link, usar recuperação de senha oficial do CRM; não gerar repetidas credenciais.
6. Pedir que o responsável confirme **primeiro login**, seleção da empresa correta, página de Leads, pipeline e acesso isolado. Registrar somente o resultado operacional — nunca a senha, token ou dados reais de leads.
7. Antes de `renews_at`, revisar se a cortesia será encerrada, prorrogada com aprovação ou migrada por um **procedimento de assinatura pago homologado**. Enquanto não houver comprovação de encerramento automático da cortesia, tratar a data como **ação administrativa obrigatória** e, se necessário, **Suspender** via Controle do Nexus CRM (que envia entitlement assinado). Não suspender ou excluir contratos sem confirmação do responsável Nexus.

## Rota B: venda paga com contratação assistida — preparação, NÃO liberada como ativação

A solicitação comercial por e-mail pode ser recebida e negociada hoje. **A ativação paga não pode ser tratada como concluída** somente com recebimento informado ou com o cadastro de cortesia.

Antes do primeiro contrato pago, exigir:

- oferta, plano, valor, ciclo, termos e consentimento aceitos pelo cliente;
- comprovante **verificado diretamente** no provedor/banco por operador autorizado (status efetivamente recebido, referência única, identidade, valor, moeda e eventual estorno);
- procedimento aprovado para registrar a receita/referência financeira sem falsificar `nexus_payments`, `nexus_sales` ou `organization_product_access`; o esquema atual não admite `provider='manual'`;
- fluxo administrativo de ativação paga auditável, condicionado ao pagamento, com MFA2, prevenção de duplicidade/segundo contrato e rollback controlado, usando o mesmo provisionamento Central → CRM;
- renovação/atraso/cancelamento com responsável definido, suspensão assinada e histórico íntegro;
- teste da entrega da primeira senha/primeiro login e conferência do tenant pelo próprio cliente.

**Não usar a tela Cliente Cortesia como atalho para uma venda paga.** Caso se ofereça um período inicial gratuito, comunicar claramente ao cliente que se trata de cortesia, e só converter para pago após homologação de conversão para o **mesmo** tenant.

## Controles de segurança e escopo

- Não criar usuários/clientes fictícios em produção para verificar layout ou simular pagamento.
- Não pedir segredos, senha ou token de login neste chat. Não transferir links de primeiro acesso à pessoa errada.
- Sem alteração em Vercel/Supabase Secrets, cobranças, webhooks, Meta, WhatsApp, Agency ou SST.
- Nenhuma ativação real nesta preparação: dados de um cliente e autorização comercial específica são necessários antes de cadastrar ou cobrar.
- Em caso de divergência Central/CRM, **não** reparar diretamente as duas bases; usar o evento/retry assinado e a auditoria administrativa.

## Critério de conclusão do primeiro piloto

Cortesia autorizada e corretamente registrada na Central, CRM com mesmo tenant e limites, administrador com primeiro login confirmado, limites entre empresas verificados, prazo e responsável pelo encerramento definidos. A comercialização paga permanece condicionada à Rota B.
