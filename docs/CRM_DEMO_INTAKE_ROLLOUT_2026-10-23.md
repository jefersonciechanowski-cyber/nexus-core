# Nexus CRM — Etapa 3: recepção de leads de demonstração

**Estado:** código em branch de trabalho, NÃO implantado. **Última revisão:** 23/10/2026.  
Controle: https://github.com/nexuscoreindustria-create/nexus-crm/issues/80

## Contexto e limites

O formulário de demonstração do site CRM ainda chama `nexus-public-crm-lead`, cuja versão publicada responde HTTP 410. O checkout chama o endpoint de vendas `nexus-public-crm-sales` também desativado: **não reativar esse checkout** nesta etapa. Os planos CRM na Central estão intencionalmente com `public_visible=false` até a etapa 4 de pagamentos.

O novo endpoint `nexus-public-crm-intake` recebe somente POST de solicitações de **demonstração**. Não cobra, não cria assinatura, não provisiona CRM, não envia convite e não modifica planos.

## Persistência na Central

O formulário fornece empresa, responsável, e-mail, telefone, tamanho da equipe, plano desejado, campos UTM e referrer.

O serviço salva uma linha em `public.nexus_sales`:
- `product_id` exclusivamente do produto `crm`, `sale_status=lead`, `lead_stage=new`, `source=site-captacao`.
- `plan_id` definido pelo catálogo ativo interno (mesmo com `public_visible=false`; registrar interesse não autoriza compra).
- `campaign_name` da UTM de campanha; `lead_notes` com UTM origem/mídia/conteúdo/termo, referência e número de usuários.
- `employee_count=NULL` porque tamanho da equipe CRM não é quantidade de colaboradores SST.
- `external_reference=crm-demo-<HMAC>` estável por e-mail + janela de 15 minutos; `nexus_sales.external_reference` já possui restrição UNIQUE. Duplicatas concorrentes retornam `ok:true` e não inserem segunda linha.
- Colunas legadas obrigatórias `provider=stripe`, `environment=production`, `billing_mode=recurring`, `billing_cycle_months=1`: metadados de um possível contrato futuro, **não indicam cobrança**.

A Central atual já lê `nexus_sales` na área administrativa de leads. Nenhuma migração SQL necessária.

## Controles de segurança

- CORS por origem exata `https://crm.nexuscore.app.br`; outras origens só via allowlist explícita `NEXUS_CRM_INTAKE_ALLOWED_ORIGINS` (origem HTTPS exata).
- `Origin` não é autenticação: aplicam-se também HMAC no fingerprint de IP, rate limit transacional `consume_nexus_public_request_limit` de **5 envios/hora/IP** e honeypot `website`.
- JSON com leitura limitada a **16 KiB**, nomes/telefones/UTM truncados, plano validado e produto CRM fixo no backend.
- Erros de banco e serviços não vazam informações privadas; não retorna ID do lead, nem confirma existência de e-mail.
- Não usa chave `service_role` no navegador: somente no ambiente seguro da função.
- Feature flag **`NEXUS_CRM_DEMO_INTAKE_ENABLED`** é obrigatória e só libera o POST se seu valor for exatamente `true`; padrão é desativado.

## Deploy seguro (após autorização)

1. Revisar PR draft na Central, executar `node --test tests/crm-demo-intake.test.mjs`, inspeção de sintaxe Deno e verificar o endpoint em ambiente controlado, sem credenciais reais.
2. Publicar a função nova `nexus-public-crm-intake` no **Supabase Central**, projeto `svphwbccqeoakpmcpvhy`, **verify_jwt=false**, mantendo a flag de ativação ausente ou `false`. Não alterar os endpoints 410 antigos ou o SST.
3. Testar método inválido, origem externa, JSON inválido, honeypot, rate limit e flag desativada, sem criar leads.
4. Aprovar PR do CRM: `app/site-captacao/preview/DemoRequestForm.tsx` aponta ao novo endpoint. Identificar a **Vercel real de `crm.nexuscore.app.br`** e testar Preview antes do merge.
5. Quando frontend e backend estiverem homologados, ativar `NEXUS_CRM_DEMO_INTAKE_ENABLED=true` na Central mediante aprovação, enviar **um lead teste identificado como teste**, com consentimento, e confirmar que aparece na **Central → Leads** com produto CRM, plano e campanha.
6. Tentar envio duplicado dentro de 15 minutos, sem produzir um novo lead. Validar erros e proteção de bots.
7. Aprovar produção do CRM e realizar smoke teste na URL final. Não ativar checkout nesta etapa.

## Reversão

Se necessário, definir `NEXUS_CRM_DEMO_INTAKE_ENABLED=false` para interromper imediatamente a criação pública de leads. Em seguida, reverter somente o deploy do formulário CRM ou do endpoint sem tocar nos demais produtos.

**Ainda pendente:** notificação por e-mail a administradores, acompanhamento de consentimento em logs, políticas LGPD formais (etapa 9), checkout/planos mensais (etapa 4). A interface agora exibe link à Política de Privacidade junto ao formulário.

## Critério de aceite da etapa 3

- [ ] Segurança/testes sintáticos e unitários executados.
- [ ] Endpoint novo funcionando em ambiente de teste.
- [ ] Frontend validado via Preview do CRM correto.
- [ ] Formulário enviado de CRM público e lead recebido na Central com campanha e plano.
- [ ] Não duplicou um lead ao reenviar.
- [ ] Serviço não admite checkout, pagamento ou criação de organizações por este endpoint.
- [ ] Produção e rollback validados sob autorização.
