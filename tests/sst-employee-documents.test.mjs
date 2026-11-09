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


const linkMigration = read('supabase/migrations/20261109170500_sst_employee_document_external_links.sql');

test('links: aceita apenas Google Drive e OneDrive em HTTPS', () => {
  const start = moduleSource.indexOf('  const trustedDriveDomains');
  const end = moduleSource.indexOf('  function readableError(error)');
  assert.ok(start > 0 && end > start);
  const normalize = new Function('URL',
    moduleSource.slice(start, end) + '\nreturn normalizeExternalUrl;')(URL);
  assert.equal(normalize(''), null);
  assert.equal(normalize('https://drive.google.com/file/d/abc/view'),
    'https://drive.google.com/file/d/abc/view');
  assert.equal(normalize('https://docs.google.com/document/d/abc/edit'),
    'https://docs.google.com/document/d/abc/edit');
  assert.equal(normalize('https://1drv.ms/b/s!123'), 'https://1drv.ms/b/s!123');
  assert.equal(normalize('https://empresa-my.sharepoint.com/:b:/g/personal/doc'),
    'https://empresa-my.sharepoint.com/:b:/g/personal/doc');
  for (const unsafe of [
    'http://drive.google.com/file/d/a', 'javascript:alert(1)',
    'https://drive.google.com.evil.com/doc', 'https://drive.google.com@evil.com/',
    'https://evilsharepoint.com/doc', 'https://example.com/doc',
    'https://drive.google.com:8443/doc'
  ]) assert.throws(() => normalize(unsafe), /Drive ou OneDrive|link válido/);
});

test('links: arquivo, URL ou ambos e acesso em nova guia', () => {
  assert.match(moduleSource, /id="employeeDocumentExternalUrl" type="url"/);
  assert.match(moduleSource, /const path = file \? /);
  assert.match(moduleSource, /if \(!file && !externalUrl\)/);
  assert.match(moduleSource, /if \(file\) \{/);
  assert.match(moduleSource, /external_url: externalUrl/);
  assert.match(moduleSource, /external_url,status,created_at/);
  assert.match(moduleSource, /data-document-link/);
  assert.match(moduleSource, /window\.open\(url, '_blank', 'noopener,noreferrer'\)/);
  assert.match(moduleSource, /createSignedUrl\(doc\.attachment_path, 600\)/);
});

test('banco: fonte externa sem arquivo com URLs limitadas e integridade preservada', () => {
  assert.match(linkMigration, /add column external_url text/);
  assert.match(linkMigration, /alter column attachment_path drop not null/);
  assert.match(linkMigration, /employee_documents_source_required check/);
  assert.match(linkMigration, /employee_documents_external_url_safe check/);
  assert.ok(linkMigration.includes('drive[.]google[.]com'));
  assert.match(linkMigration, /new\.external_url is distinct from old\.external_url/);
  assert.match(linkMigration, /grant insert \(external_url\) on public\.employee_documents to authenticated/);
  assert.doesNotMatch(linkMigration, /drop table|truncate table|delete from public\.employee_documents/i);
});
