# Nexus Central: Asaas Pix/Boleto mensal, preparação OFF (28/10/2026)

- Branch separada de main e sem alterações no Stripe, Agency, SST ou tenants.
- Funções de link mensal, inbox de webhook, verificação e provisionamento retornam 503 incondicional antes de chamada ao provedor ou banco. NENHUMA cobrança autorizada.
- Payment links Asaas RECURRENT/MONTHLY; boleto/PIX pagos por ciclo, sem compra anual ou Pix Automático presumido. Documentação Asaas: https://docs.asaas.com/docs/criando-um-link-de-pagamentos
- SQL são rascunhos não aplicados ao banco, e testes usam somente dados fictícios. 
- Asaas Sandbox API key, webhook autorizado, estados do provedor, entrega de tenant e primeira autenticação devem ser comprovados antes de qualquer habilitação.
- Checkout do CRM segue com opção Pix/boleto oculta atrás das flags. Não ativar flags ou mostrar meios ainda não homologados.
- O objetivo nesta rodada é deixar código versionado, CI verde e endpoints publicados **desativados**, sem alterar clientes ou cobrar.
