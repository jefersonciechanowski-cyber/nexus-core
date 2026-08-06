# AGENTS.md — Nexus Core

## Projeto oficial

Trabalhe exclusivamente no repositório oficial:

`C:\Projetos\nexus-core`

Não use, edite ou copie arquivos de pastas antigas, especialmente:

- `Downloads`
- `nexus-core-ready`
- cópias exportadas
- versões de demonstração desatualizadas

Antes de qualquer alteração, confirme que o repositório está na branch correta e atualizado com a `main`.

## Empresa e produto

Empresa:

`NEXUS CORE TECNOLOGIA LTDA`

Produto atual:

`SST Controle`

Posicionamento:

`A plataforma completa para gestão de Saúde e Segurança do Trabalho.`

## Identidade visual

Preserve integralmente a identidade visual aprovada.

Não altere sem autorização explícita:

- logo oficial;
- cores;
- tipografia;
- slogan;
- layout principal;
- páginas de login;
- página de alteração de senha;
- cabeçalho;
- menu lateral;
- componentes visuais aprovados.

Arquivo oficial da logo:

`apps/sst-controle/logo-nexus-core.png`

A logo nunca deve ser recriada com texto, CSS, símbolos aproximados ou imagens alternativas.

## Arquivo principal aprovado

O sistema existente em:

`apps/sst-controle/index.html`

é a base funcional aprovada.

Não substituir, simplificar, reescrever ou gerar um novo sistema.

As alterações devem ser pequenas, localizadas e compatíveis com o funcionamento atual.

## Supabase

O Supabase é a fonte oficial dos dados.

Não criar novos fallbacks usando:

- localStorage;
- sessionStorage para dados operacionais;
- dados simulados;
- arrays locais como persistência;
- dataStore como banco definitivo.

O `sessionStorage` pode ser utilizado apenas para informações da sessão autenticada.

Use somente:

```javascript
window.NexusAuth.getClient()
```

A organização autenticada deve ser obtida de:

```javascript
sessionStorage.getItem('nexus_demo_session')
```

Toda consulta deve respeitar o `organizationId`.

Mesmo com RLS ativo, filtre explicitamente por:

```javascript
.eq('organization_id', organizationId)
```

Nunca utilizar no navegador:

- service_role;
- secret key;
- chave privada;
- credenciais administrativas.

## Autenticação

Arquivos oficiais:

- `apps/sst-controle/supabase-config.js`
- `apps/sst-controle/supabase-auth.js`
- `apps/sst-controle/login.html`
- `apps/sst-controle/alterar-senha.html`

Não alterar o fluxo de autenticação sem solicitação explícita.

O objeto existente é:

```javascript
window.NexusAuth
```

Métodos disponíveis:

```javascript
login()
logout()
restoreSession()
getClient()
```

## Arquitetura de integração

Evite criar um arquivo completo e repetitivo para cada entidade.

Crie uma camada reutilizável de acesso a dados, preferencialmente:

`apps/sst-controle/supabase-data.js`

Essa camada deve centralizar:

- cliente Supabase;
- organização autenticada;
- listagem;
- cadastro;
- atualização;
- exclusão;
- tratamento de erros;
- filtros por organização;
- prevenção de envios duplicados;
- atualização do estado da interface.

Os módulos devem informar somente:

- tabela;
- campos;
- relacionamentos;
- validações específicas;
- função de renderização.

Não duplicar lógica CRUD em vários arquivos.

## Ordem de migração

Trabalhar em lotes.

### Lote 1 — Estrutura organizacional

- units
- sectors
- job_roles
- employees

### Lote 2 — Operação SST

- exam_records
- training_records
- occurrences
- riscos e controles relacionados

### Lote 3 — EPIs e Matriz

- epi_catalog
- epi_purchases
- epi_deliveries
- control_matrix_rules

Não iniciar outro lote antes de concluir e validar o lote atual.

## Regras de segurança dos dados

Antes de excluir registros, verificar vínculos existentes.

Não permitir exclusão que possa:

- apagar registros relacionados silenciosamente;
- quebrar históricos;
- deixar referências inválidas;
- prejudicar auditoria;
- remover dados de outra organização.

Utilizar confirmação visual antes de exclusões definitivas.

Preservar históricos sempre que possível.

## Compatibilidade com o sistema atual

O sistema utiliza o objeto:

```javascript
window.NEXUS_SST_APP
```

Antes de utilizar métodos desse objeto, confirme que eles existem.

Não presuma funções que não estejam declaradas.

Não misture:

- nomes antigos;
- funções removidas;
- código de diff;
- versões duplicadas;
- fallbacks legados.

Cada função deve ser declarada uma única vez.

## Alterações no index.html

Evite alterações extensas no `index.html`.

Prefira arquivos JavaScript externos.

Ao adicionar scripts, respeite a ordem:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="supabase-config.js"></script>
<script src="supabase-auth.js"></script>
<script src="supabase-data.js"></script>
```

Scripts específicos devem ser carregados somente depois de suas dependências.

Não criar carregamento dinâmico de scripts sem necessidade.

## Processo obrigatório antes de entregar

Antes de considerar uma tarefa concluída:

1. Ler os arquivos atuais da branch.
2. Confirmar que está trabalhando no repositório oficial.
3. Revisar o schema Supabase correspondente.
4. Verificar políticas RLS e permissões.
5. Executar validação de sintaxe JavaScript.
6. Verificar tags e blocos `<script>` do HTML.
7. Procurar funções duplicadas.
8. Procurar referências a localStorage e fallbacks.
9. Revisar o diff completo.
10. Confirmar que nenhum arquivo fora do escopo foi alterado.
11. Informar todos os arquivos modificados.
12. Informar testes executados e possíveis limitações.

## Testes mínimos por entidade

Para cada entidade integrada:

1. carregar registros;
2. cadastrar registro;
3. atualizar a página;
4. confirmar persistência;
5. excluir registro permitido;
6. atualizar a página;
7. confirmar exclusão;
8. testar bloqueio de exclusão com vínculos;
9. confirmar isolamento por organização;
10. verificar mensagens de erro no console.

## Git

Nunca trabalhar diretamente na `main`.

Criar uma branch específica para cada lote ou correção.

Exemplos:

```text
feat/supabase-organizational-structure-v1
feat/supabase-sst-operations-v1
feat/supabase-epi-matrix-v1
fix/nome-da-correcao-v1
```

Não criar commits que misturem tarefas diferentes.

Não alterar histórico Git.

Não fazer merge automaticamente sem revisão.

## Entrega ao usuário

Ao terminar uma implementação:

- mostrar o conteúdo final dos arquivos novos;
- mostrar somente os trechos alterados dos arquivos grandes;
- não apresentar linhas antigas misturadas com linhas novas;
- não entregar apenas um resumo;
- informar riscos encontrados;
- aguardar revisão antes de publicação.

## Regra principal

Preservar o sistema aprovado e evoluí-lo com segurança.

Não reconstruir o projeto.

Não improvisar estruturas paralelas.

Não alterar a identidade visual.

Não avançar para outro módulo sem concluir os testes do lote atual.