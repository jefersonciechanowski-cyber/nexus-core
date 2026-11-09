import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const source = read('apps/sst-controle/supabase-organizational.js');
const html = read('apps/sst-controle/index.html');
const css = read('apps/sst-controle/employee-list.css');

test('colaboradores: estrutura e comandos preservados', () => {
  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /class="employee-list-row"/);
  assert.match(source, /class="employee-list-details"/);
  assert.match(source, /class="employee-list-actions"/);
  const actions = [
    'show-employee',
    'open-employee-documents',
    'edit-employee',
    'deactivate-employee'
  ];
  for (const action of actions) {
    assert.match(source, new RegExp('data-organizational-action="' + action + '"'));
    assert.match(source, new RegExp("'" + action + "': \\(\\) =>"));
  }
  assert.match(source, /includes\(window\.NEXUS_DEMO_USER\?\.role\)/);
});

test('colaboradores: CSS restrito à lista e sem quebra de botões no desktop', () => {
  assert.equal(html.match(/href="employee-list\.css"/g)?.length, 1);
  assert.match(css, /#employeeList\s*\{\s*container-type:\s*inline-size/);
  assert.match(css, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+max-content/);
  assert.match(css, /grid-template-columns:\s*repeat\(4,\s*96px\)/);
  assert.match(css, /#employeeList\s+\.employee-list-actions\s*>\s*button/);
  assert.match(css, /white-space:\s*nowrap/);
  assert.match(css, /@container\s*\(max-width:\s*730px\)/);
  assert.match(css, /@container\s*\(max-width:\s*440px\)/);
  assert.match(css, /grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.doesNotMatch(css, /display:\s*none/);
});

test('colaboradores: alterações não criam novas fontes de dados', () => {
  assert.doesNotMatch(css, /https?:\/\//);
  assert.doesNotMatch(source, /service_role/);
  assert.doesNotMatch(source, /localStorage/);
});
