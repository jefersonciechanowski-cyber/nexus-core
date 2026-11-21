import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/central-stored-artifact-restore.yml', import.meta.url), 'utf8');
const producer = readFileSync(new URL('../.github/workflows/central-real-restore-drill.yml', import.meta.url), 'utf8');
test('stored artifact disaster recovery has no production DB connection and minimal permissions', () => {
  assert.match(workflow, /workflow_run:/);
  assert.match(workflow, /Central encrypted backup & isolated real restore/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /CENTRAL_SOURCE_DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY|pg_dump\b|postgresql:\/\//);
  assert.match(workflow, /\[ "\$source_branch" = 'main' \]/);
  assert.match(workflow, /--network none/);
  assert.match(workflow, /HostConfig\.NetworkMode/);
  assert.match(workflow, /trap cleanup EXIT/);
});
test('stored artifact is checked, decrypted privately and restored with strict security assertions', () => {
  for(const required of [
    /gh run download/, /sha256sum -c/, /gpg --batch --yes/,
    /security-digest\.txt/, /source-integrity\.csv/, /sequence-acl\.sql/,
    /tarfile\.open/, /getmembers\(\)/, /m\.isfile\(\)/,
    /pg_restore -U postgres -d central_restore --single-transaction --exit-on-error/,
    /central-integrity-safe-diagnostics\.py verify/,
    /SET LOCAL ROLE authenticated/, /request\.jwt\.claim\.sub/,
    /observed_snapshot_age_minutes=/
  ]) assert.match(workflow, required);
  assert.doesNotMatch(workflow, /actions\/upload-artifact/);
});
test('produced encrypted package embeds independent source digests and checkpoint time', () => {
  for(const name of ['central.dump', 'sequence-acl.sql', 'source-integrity.csv',
    'security-digest.txt', 'captured-utc.txt', 'source-storage-inventory.json']) {
    assert.ok(producer.includes(name), 'missing bundle member ' + name);
  }
  assert.match(producer, /central-storage-backup\.py export/);
  assert.match(producer, /source-storage-inventory\.json storage/);
  assert.match(producer, /tar -czf/);
  assert.match(producer, /AES256 --symmetric/);
});

test('cold recovery exercises real org-admin RLS and payment tenant links without writes', () => {
  const sql = readFileSync(new URL('../scripts/central-restore-functional-acceptance.sql', import.meta.url), 'utf8');
  assert.match(workflow, /central-restore-functional-acceptance\.sql/);
  assert.match(workflow, /PASS: restored actual organization-admin RLS/);
  assert.match(sql, /BEGIN TRANSACTION READ ONLY/);
  assert.match(sql, /SET LOCAL ROLE authenticated/);
  assert.match(sql, /request\.jwt\.claim\.sub/);
  assert.match(sql, /role::text = 'org_admin'/);
  assert.match(sql, /visible_foreign <> 0/);
  assert.match(sql, /nexus_payments/);
  assert.match(sql, /nexus_payment_checkouts/);
  assert.match(sql, /organization_product_access/);
  assert.match(sql, /ROLLBACK/);
  // No data modifications or secret values are permitted in this test script.
  assert.doesNotMatch(sql, /^\s*(INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE|CALL)\s/mi);
});
