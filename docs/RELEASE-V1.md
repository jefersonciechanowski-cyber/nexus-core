# Nexus Core / Nexus SST — Fechamento funcional da V1

Data de referência: 11/08/2026.

## Produto entregue

A V1 reúne:

- site comercial para prospecção e contratação;
- captação de leads de demonstração;
- checkout recorrente via Stripe para novas vendas;
- opção anual à vista no boleto com 2 meses de economia;
- Webhook financeiro com verificação de assinatura e idempotência;
- criação automática de empresa e usuário após pagamento confirmado;
- primeiro acesso e definição/recuperação de senha;
- Minha Central Nexus para sistemas contratados e situação da assinatura;
- Central Nexus administrativa para empresas, acessos, planos e pagamentos;
- Nexus SST como primeiro aplicativo do ecossistema.

## Nexus SST — módulos consolidados

- cadastro legal da empresa, unidades, setores, funções e colaboradores;
- exames, requisitos, coletas e avaliações;
- treinamentos, matriz de necessidade, registros e certificados;
- EPIs, compras, entregas, reposição e descarte;
- matriz de controle por setor/função;
- ocorrências e histórico;
- dashboard executivo;
- Central de Documentação e Fiscalizações;
- anexos privados e histórico de exigências;
- agenda preventiva integrada a exames, treinamentos, EPIs, documentos e fiscalizações;
- central de alertas e envio de e-mails;
- auditoria de ações críticas e geração documental.

## Precificação pública da V1

O contrato usado durante os testes do PR #40 permanece preservado como plano legado e não é alterado retroativamente.

Novas vendas usam:

- Nexus SST Essencial — R$ 97,00/mês — até 50 colaboradores ativos;
- Nexus SST Profissional — R$ 197,00/mês — até 100 colaboradores ativos;
- Nexus SST Empresarial — R$ 297,00/mês — até 250 colaboradores ativos;
- Nexus SST Corporativo — acima de 250 colaboradores — sob consulta.

A diferenciação comercial da V1 é principalmente pelo volume de colaboradores ativos; os módulos principais permanecem disponíveis nas faixas publicadas.

Para os planos públicos, a opção anual à vista cobra o equivalente a 10 mensalidades e libera 12 meses de acesso.

## Fluxo comercial alvo

Site → escolha do plano e modelo de cobrança → cadastro da empresa → Stripe Checkout → confirmação por Webhook → criação da organização → criação do administrador → liberação do Nexus SST → e-mail de primeiro acesso → Minha Central Nexus.

O histórico financeiro criado durante a integração anterior com Asaas permanece preservado para auditoria e compatibilidade, mas novas contratações usam Stripe.

## Segurança concluída

A revisão pré-produção foi executada e resultou em:

- migration 033 de hardening;
- revisão de privilégios e RLS;
- reforço de isolamento entre organizações;
- fechamento de RPCs internas desnecessárias;
- neutralização dos endpoints legados do Asaas;
- smoke tests de escrita como `org_admin` comum;
- validação de documentos, certificados, Storage privado e auditoria;
- senha mínima de 8 caracteres.

A proteção contra senhas vazadas permanece dependente de plano Supabase compatível.

## Etapa atual

A V1 está funcionalmente aprovada e entra em **readiness de produção**.

Antes de receber clientes reais, concluir `docs/PRODUCTION-CHECKLIST.md`, especialmente:

- domínio próprio;
- remetentes transacionais verificados;
- Stripe live e webhook live;
- `NEXUS_PUBLIC_URL` e URLs de Auth definitivas;
- teste controlado de pagamento real;
- manual/e-book de utilização entregue ao cliente.
