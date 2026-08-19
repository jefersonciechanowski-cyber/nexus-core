# Nexus AI Core v0.1

## Objetivo

Criar a camada central de governanca da Nexus AI dentro do Nexus Core, sem acoplar a inteligencia a um unico produto.

A Central Nexus administra contrato, pacote, limites, pausas, acesso por usuario e consumo. Cada produto (SST Controle, Nexus Agency, Nexus CRM e futuros produtos) recebe apenas as capacidades e ferramentas autorizadas para aquele contexto.

## Principios

1. **Nucleo compartilhado, dados isolados** — o Nexus AI Core compartilha regras comerciais e de consumo, mas nao mistura dados operacionais entre produtos ou empresas.
2. **Sem SQL livre para o modelo** — cada produto expõe ferramentas explicitas e server-side com escopo de organizacao.
3. **Menor privilegio** — o modelo nunca recebe `service_role`, segredos, chaves ou acesso administrativo direto.
4. **Consentimento e controle** — o dono da empresa pode aceitar, pausar, desativar e restringir usuarios sem cancelar automaticamente o pacote comercial.
5. **Limite antes do consumo** — toda capacidade paga deve ter franquias mensais de requisicoes/tokens e, quando aplicavel, limite monetario.
6. **Auditoria sem conteudo por padrao** — o ledger registra organizacao, produto, capacidade, modelo, tokens, custo e status; nao grava prompt/resposta por padrao.
7. **Automacao separada de assistencia** — ajuda de uso e analise nao implicam permissao para responder leads ou executar acoes.

## Pacotes iniciais

- `assist`: ajuda de uso e navegacao no produto.
- `intelligence`: ajuda + analises autorizadas do produto.
- `automation`: ajuda + analises + automacoes explicitamente contratadas.
- `custom`: capacidades e limites definidos por contrato.

## Escopo por produto

### Central Nexus / Nexus Admin

Responsavel por:
- entitlement por empresa e produto;
- pacote e provider mode;
- limites mensais;
- pausa/desativacao da empresa;
- override por usuario;
- medicao consolidada de consumo e custo;
- auditoria e saude da camada de IA.

A IA administrativa central deve consultar apenas visoes/ferramentas administrativas permitidas. Ela nao recebe acesso irrestrito aos dados operacionais do SST, Agency ou CRM.

### SST Controle

Capacidades futuras: ajuda de uso, resumo de pendencias, exames, treinamentos, EPIs, documentos e indicadores de SST. Ferramentas separadas e escopadas por `organization_id`.

### Nexus Agency

Capacidades futuras: operacao de clientes, tarefas, criativos, campanhas, SLAs e gargalos. Ferramentas separadas do SST e da Central.

### Nexus CRM

Segue a mesma governanca comercial do Nexus AI Core, mas pode permanecer em infraestrutura/repositório proprio. A integracao futura deve usar identificadores explicitos de empresa/produto, nunca inferencia por nome ou email.

## Modelo de controle

A governanca usa quatro camadas independentes:

1. **Entitlement comercial** — o que foi contratado.
2. **Controle da empresa** — ligado, pausado ate data, ou desativado.
3. **Acesso individual** — herdar regra da empresa, permitir, bloquear ou pausar.
4. **Quota/ledger** — requisicoes, tokens e custo consumido no periodo.

Pausar uso nao cancela assinatura nem devolve franquia ja consumida.

## Primeira migration

A migration `20260819093000_nexus_ai_core.sql` cria apenas a infraestrutura central de governanca e medicao. Ela nao ativa OpenAI, nao adiciona chave, nao cria automacao e nao faz chamadas pagas.

## Proximo gate

Antes de ativar qualquer provedor:

1. validar migration em ambiente controlado;
2. revisar RLS e grants;
3. construir a primeira tela de administracao no Nexus Admin;
4. definir uma organizacao de teste e franquia minima;
5. configurar chave somente no ambiente server-side de teste;
6. executar chamadas controladas e medir custo/qualidade;
7. somente depois liberar um primeiro produto consumidor.
