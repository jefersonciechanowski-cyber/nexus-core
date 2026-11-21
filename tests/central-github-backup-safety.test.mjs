import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/central-real-restore-drill.yml', import.meta.url), 'utf8');
const synthetic = readFileSync(new URL('../.github/workflows/central-offline-restore-test.yml', import.meta.url), 'utf8');

// Static safety invariants: fail CI before a change to this backup workflow lands.
// This does not replace an actual backup/restore or a GitHub secrets configuration test.
test('real Central backup requires encrypted credentials and narrow GitHub permissions', () => {
  assert.match(workflow, /permissions:\s*\n\s+contents: read/);
  assert.match(workflow, /CENTRAL_SOURCE_DATABASE_URL:.*secrets\.CENTRAL_SOURCE_DATABASE_URL/);
  assert.match(workflow, /CENTRAL_BACKUP_ENCRYPTION_PASSWORD:.*secrets\.CENTRAL_BACKUP_ENCRYPTION_PASSWORD/);
  assert.match(workflow, /test -n .*CENTRAL_SOURCE_DATABASE_URL/);
  assert.match(workflow, /test -n .*CENTRAL_BACKUP_ENCRYPTION_PASSWORD/);
  assert.match(workflow, /svphwbccqeoakpmcpvhy/);
  assert.match(workflow, /default_transaction_read_only=on/);
  assert.match(workflow, /PGSSLMODE.*require/);
  assert.doesNotMatch(workflow, /\b--(no-owner|no-privileges|disable-row-security)\b/);
});

test('target is disposable and offline and comparisons fail closed', () => {
  assert.match(workflow, /--network none/);
  assert.match(workflow, /HostConfig\.NetworkMode/);
  assert.match(workflow, /pg_dump --format=custom --schema=public --schema=auth --schema=storage --schema=private/);
  assert.match(workflow, /pg_restore -U postgres -d central_restore/);
  assert.match(workflow, /--single-transaction --exit-on-error/);
  assert.match(workflow, /security_restored.*security_before/);
  assert.match(workflow, /python3 scripts\/central-integrity-safe-diagnostics\.py verify/);
  assert.match(workflow, /trap cleanup EXIT/);
  assert.match(workflow, /rm -rf "\$work"/);
});

test('only encrypted backup and checksum can be uploaded as artifacts', () => {
  assert.match(workflow, /--cipher-algo AES256 --symmetric/);
  assert.match(workflow, /--decrypt --output \/dev\/null/);
  assert.match(workflow, /actions\/upload-artifact@/);
  const upload = workflow.split(/\n\s+- name: Store encrypted verified Central snapshot in GitHub/)[1];
  assert.ok(upload, 'encrypted artifact upload step missing');
  const uploadSection = upload.split(/\n\s+- name: Remove encrypted files/)[0];
  assert.match(uploadSection, /\*\.gpg/);
  assert.match(uploadSection, /\*\.sha256/);
  assert.doesNotMatch(uploadSection, /\.dump\b|\.sql\b|\.tar\b|backup\.zip\b/);
  assert.match(workflow, /retention-days: 30/);
});

test('synthetic positive/negative restore runs on real workflow changes', () => {
  const hits = synthetic.match(/central-real-restore-drill\.yml/g) ?? [];
  assert.ok(hits.length >= 2, 'synthetic CI must cover PR and main changes to backup workflow');
  assert.match(synthetic, /CENTRAL_DR_TEST_REVOKE_ACL/);
  assert.match(synthetic, /revoked GRANT is detected/);
  assert.match(synthetic, /security_digest_match/);
});

test('recovery package includes encrypted replayable source sequence ACLs', () => {
  const source = readFileSync(new URL('../scripts/central-restore-sequence-acl.sql', import.meta.url), 'utf8');
  assert.match(source, /SELECT format\(/);
  assert.match(source, /aclexplode\(c\.relacl\)/);
  assert.match(source, /c\.relkind = 'S'/);
  assert.match(workflow, /source_sql central-restore-sequence-acl\.sql > "\$work\/sequence-acl\.sql"/);
  assert.match(workflow, /psql -U postgres -d central_restore/);
  assert.match(workflow, /-f \/tmp\/sequence-acl\.sql/);
  assert.match(workflow, /tar -czf .*central-recovery-package\.tar\.gz/);
  assert.match(workflow, /central\.dump sequence-acl\.sql/);
  assert.match(workflow, /central-verified-.*\.tar\.gz\.gpg/);
});
