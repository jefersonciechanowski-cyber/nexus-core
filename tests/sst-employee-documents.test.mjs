import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const moduleSource = read('apps/sst-controle/supabase-employee-documents.js');
const migration = read('supabase/migrations/20261109143000_sst_employee_document_folders.sql');
const organizational = read('apps/sst-controle/supabase-organizational.js');
const preventive = read('apps/sst-controle/supabase-preventive-agenda.js');
const alerts = read('apps/sst-controle/supabase-alert-center.js');
const html = read('apps/sst-controle/index.html');

test('pasta de documentos: scripts sem erros de sintaxe', () => {
  for (const source of [moduleSource, organizational, preventive, alerts]) {
    assert.doesNotThrow(() => new Function(source));
  }
});

test('pasta de documentos: página carrega o módulo na ordem correta', () => {
  assert.equal(html.match(/src="supabase-employee-documents\.js"/g)?.length, 1);
  assert.ok(html.indexOf('supabase-organizational.js') < html.indexOf('supabase-employee-documents.js'));
  assert.ok(html.indexOf('supabase-employee-documents.js') < html.indexOf('supabase-preventive-agenda.js'));
  assert.match(organizational, /open-employee-documents/);
});

test('documentos: acesso privado, vínculo ao funcionário, arquivamento e alertas', () => {
  assert.match(moduleSource, /from\(bucket\)\.upload\(path, file/);
  assert.match(moduleSource, /createSignedUrl\(doc\.attachment_path, 600\)/);
  assert.match(moduleSource, /employee_id: employeeId/);
  assert.match(moduleSource, /status: 'ARCHIVED'/);
  assert.match(moduleSource, /doc\.status === 'ACTIVE' && doc\.expires_at/);
  assert.match(preventive, /NexusEmployeeDocuments\?\.getDeadlines/);
  assert.match(alerts, /openModule\(item\.type, item\)/);
  assert.doesNotMatch(moduleSource, /localStorage/);
  assert.doesNotMatch(moduleSource, /service_role/);
});

test('banco: isolamento por organização, auditoria e permissões limitadas', () => {
  assert.match(migration, /alter table public\.employee_documents enable row level security/);
  assert.match(migration, /foreign key \(employee_id, organization_id\)/);
  assert.match(migration, /references public\.employees \(id, organization_id\) on delete restrict/);
  assert.match(migration, /create trigger employee_documents_audit/);
  assert.match(migration, /on storage\.objects as restrictive for select to authenticated/);
  assert.match(migration, /grant select on public\.employee_documents to authenticated/);
  assert.doesNotMatch(migration, /grant .*delete.*employee_documents/i);
});
