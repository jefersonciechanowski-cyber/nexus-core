# Nexus CRM — verificação real de limitação de login por senha

Data: 21/11/2026 (Brasil). Escopo: Nexus CRM, autenticação Supabase em produção.

## Resultado e evidências

**APROVADO — bloqueio e recuperação observados na rota real de login por senha.**

- Execução: https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44861164160
- Fluxo: `POST /auth/v1/token?grant_type=password` no projeto Supabase de produção do CRM.
- Origem: runner público GitHub Actions, sem compartilhar IP com o cliente.
- Identidade: endereço aleatório de domínio RFC 2606 `.invalid`, senha deliberadamente inválida. Nenhuma conta de usuário real foi utilizada.
- Limite de segurança do script: no máximo 48 requisições; parada automática no primeiro 429 (as já iniciadas podem terminar).
- Execução: 44 tentativas até concluir as chamadas em andamento. 30 respostas HTTP 400 (credenciais inexistentes) e 14 respostas HTTP 429. Código do provedor para os bloqueios: `over_request_rate_limit`.
- Após 10 segundos, uma única nova tentativa recebeu HTTP 400 (e não 429). Não foi possível autenticar nenhuma conta.
- Confirmação independente: logs agregados do Supabase para 21/11/2026 das 03h25 às 03h30 UTC mostraram **31 respostas 400 e 14 respostas 429** na rota `/auth/v1/token`. A resposta 400 adicional corresponde à tentativa de recuperação.
- Nenhuma inscrição, cobrança, e-mail, mensagem WhatsApp ou ação sobre clientes foi produzida.

## O que este teste prova

O endpoint **real** do projeto em produção aplicou limitação de chamadas a um fluxo de login com senha, retornando 429, e posteriormente deixou passar uma nova tentativa de senha (que continuou inválida, HTTP 400). O projeto já possuía teste de interface para 429 e ensaio de recuperação de senha. Este teste complementa aquela cobertura.

O teste **não** verifica rate limiting por conta, riscos de tentativas distribuídas entre IPs diferentes, políticas CAPTCHA, abuso sustentado por períodos longos, nem confirmação humana de todos os canais de alerta. Não garante segurança absoluta contra força bruta.

## Falso positivo conhecido em monitoramento

As 14 respostas 429 na janela 03h25–03h30 UTC foram provocadas por este **teste sintético autorizado**, não por ataque. O monitor horário existente poderá disparar um aviso se sua janela incluir esse período. Qualquer alerta referente exclusivamente a essa janela e a essas contagens deve ser analisado como efeito do ensaio; não suprimir outros incidentes reais.

## Situação do plano (18 critérios)

- Convites, login, recuperação e MFA opcional do CRM: **2/2** para os testes definidos.
- Segurança/produção CRM + Central: **16/18 (88,9%)**, após a comprovação real de login.
- Pendências não alteradas: (1) restauração **integral** de backup da Central em PostgreSQL isolado, incluindo permissões e RTO/RPO de desastre; (2) confirmação de indexação no Google Search Console, junto à captação móvel.

## Outras evidências desta rodada

- Formulário no celular/desktop: correção de navegação publicada no CRM, PR https://github.com/nexuscoreindustria-create/nexus-crm/pull/205.
- Chrome real em produção, com `POST` simulado e WhatsApp interceptado: https://github.com/jefersonciechanowski-cyber/nexus-core/actions/runs/44860931629. A interface passou pelos caminhos de erro e de sucesso sem criar um lead real.
- Recuperação lógica **parcial** da Central: um snapshot de 8 tabelas críticas, 66 registros e somente colunas operacionais sem PII, foi recuperado num banco local isolado SQLite. Todas as contagens, estados e vínculos foram reproduzidos sem divergências. **Isso não equivale a restaurar o backup nativo integral do PostgreSQL/Supabase e não fecha o critério de disaster recovery.**
- Search Console permanece não conectado ao OpenSEO: https://app.openseo.so/p/381654de-eb74-4c9c-89f5-1d3c469a4988/search-performance

Segurança do processo: nenhum token, senha, e-mail sintético, IP do executor ou identificador de cliente foi escrito neste relatório.
