import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const edge = readFileSync(new URL('../supabase/functions/nexus-central-storage-backup/index.ts', import.meta.url), 'utf8');
const backup = readFileSync(new URL('../.github/workflows/central-real-restore-drill.yml', import.meta.url), 'utf8');
const recovery = readFileSync(new URL('../.github/workflows/central-stored-artifact-restore.yml', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../scripts/central-storage-inventory.sql', import.meta.url), 'utf8');
const script = fileURLToPath(new URL('../scripts/central-storage-backup.py', import.meta.url));

test('bucket-scoped GitHub OIDC verifies signature, audience, source workflow and repository', () => {
  for (const part of [
    'token.actions.githubusercontent.com/.well-known/jwks', 'RSASSA-PKCS1-v1_5',
    'crypto.subtle.verify', 'repository_id', '1323260483',
    'workflow_ref', '/.github/workflows/central-real-restore-drill.yml@',
    'refs/heads/main', 'claims.aud === AUDIENCE', 'claims.iss === ISSUER',
    'claims.exp', 'sst-documents', 'request.method !== "POST"',
    'Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")', 'return deny(401)',
  ]) assert.ok(edge.includes(part), 'OIDC gate missing: '+part);
  assert.ok(edge.includes('claims.repository_id === REPO_ID'), 'signed immutable repository ID must match');
  assert.ok(edge.includes('claims.workflow_ref === WORKFLOW_REF'), 'signed workflow source must match');
  assert.ok(edge.includes('claims.ref === REF'), 'signed branch must match');
  assert.ok(edge.includes('method: "GET"'), 'Storage access must be read-only GET');
  assert.ok(edge.includes('central_storage_oidc_denied='), 'safe OIDC rejection category must be logged');
  assert.doesNotMatch(edge, /console\\.(?:log|warn|error)\\([^)]*(?:token|claims|secret|key)\\s*\\)/);
  assert.doesNotMatch(edge, /method: "(?:POST|PUT|PATCH|DELETE)"[^\n]*storage/);
  assert.doesNotMatch(backup, /SUPABASE_SERVICE_ROLE_KEY|CENTRAL_STORAGE_SERVICE_ROLE_KEY/);
  assert.match(backup, /id-token: write/);
  assert.match(backup, /central-storage-backup\.py export/);
  assert.match(backup, /--cipher-algo AES256 --symmetric/);
  assert.match(backup, /storage-inventory\.json storage/);
});
test('independent restore checks ciphertext, expected archive members, all private bytes', () => {
  for (const part of [
    'sha256sum -c', 'gpg --batch --yes',
    'storage/manifest.json', 'storage/blobs/',
    'source-storage-inventory.json',
    'central-storage-backup.py verify',
    'docker exec "$name" psql',
    '--network none',
  ]) assert.ok(recovery.includes(part), 'missing independent check '+part);
  assert.doesNotMatch(recovery, /CENTRAL_SOURCE_DATABASE_URL|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(sql, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(sql, /storage\.objects/);
  assert.match(sql, /bucket_private/);
});

test('private backup verifies exact object bytes and metadata; corruption fails closed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'central-storage-unit-'));
  try {
    mkdirSync(join(dir, 'storage', 'blobs'), { recursive: true });
    const content = Buffer.from('Private test object with unique fictional bytes');
    const name = 'test-folder/fictional.txt';
    const blob = createHash('sha256').update('sst-documents' + String.fromCharCode(0) + name).digest('hex');
    const digest = createHash('sha256').update(content).digest('hex');
    const metadata = { name, bytes: content.length, updated_at: '2026-11-21 12:00:00+00' };
    const inventory = { version:1, bucket:'sst-documents', bucket_present:1, bucket_private:true, total_buckets:1, objects:[metadata] };
    const manifest = { version:1, bucket:'sst-documents', total_bytes:content.length, objects:[{...metadata,blob,sha256:digest}] };
    const source = join(dir,'source.json'), restored=join(dir,'restored.json');
    writeFileSync(source, JSON.stringify(inventory));
    writeFileSync(restored, JSON.stringify(inventory));
    writeFileSync(join(dir,'storage','manifest.json'), JSON.stringify(manifest));
    writeFileSync(join(dir,'storage','blobs',blob), content);
    const check = () => spawnSync('python3',[script,'verify',source,restored,join(dir,'storage')],{encoding:'utf8'});
    let result = check();
    assert.equal(result.status, 0, result.stdout+result.stderr);
    assert.match(result.stdout,/PASS: independently recovered private Storage bytes/);
    assert.ok(!result.stdout.includes(name));
    writeFileSync(join(dir,'storage','blobs',blob), Buffer.from('altered data same format'));
    result = check();
    assert.equal(result.status, 1, 'tampering must fail');
    assert.match(result.stdout, /storage_failure_phase=restore_bytes/);
    assert.ok(!result.stdout.includes(name));
    writeFileSync(join(dir,'storage','blobs',blob), content);
    writeFileSync(restored,JSON.stringify({...inventory,objects:[{...metadata,bytes:content.length+1}]}));
    assert.equal(check().status, 1, 'metadata changes must fail');
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
