# Nexus Core / Nexus SST — Fechamento funcional da V1

Data de referência: 10/08/2026.

## Produto entregue

A V1 reúne:

- site comercial para prospecção e contratação;
- captação de leads de demonstração;
- checkout recorrente via Asaas;
- Webhook financeiro com idempotência;
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
- central de documentos e dossiê de fiscalização;
- agenda preventiva, alertas e envio de e-mails;
- auditoria de ações críticas e geração documental.

## Precificação pública da V1

O contrato usado durante os testes do PR #40 permanece preservado como plano legado e não é alterado retroativamente.

Novas vendas usam:

- Nexus SST Essencial — R$ 97,00/mês — até 50 colaboradores ativos;
- Nexus SST Profissional — R$ 197,00/mês — até 100 colaboradores ativos;
- Nexus SST Empresarial — R$ 297,00/mês — até 250 colaboradores ativos;
- Nexus SST Corporativo — acima de 250 colaboradores — sob consulta.

A diferenciação comercial da V1 é principalmente pelo volume de colaboradores ativos; os módulos principais permanecem disponíveis nas faixas publicadas.

## Fluxo comercial alvo

Site → escolha do plano → cadastro da empresa → checkout Asaas → confirmação por Webhook → criação da organização → criação do administrador → liberação do Nexus SST → e-mail de primeiro acesso → Minha Central Nexus.

## Próxima etapa obrigatória após validação funcional

Realizar a revisão de segurança registrada em `docs/SECURITY-REVIEW-PLAN.md` antes de ampliar a operação comercial em produção.
