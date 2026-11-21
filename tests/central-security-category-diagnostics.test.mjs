import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/central-security-category-diagnostics.py', import.meta.url));
const original = fileURLToPath(new URL('../scripts/central-restore-security-fingerprint.sql', import.meta.url));
const categories = ['objects', 'table_grants', 'policies', 'functions',
  'function_grants', 'schema_owners', 'schema_grants'];
function execute(...args) {
  const result = spawnSync('python3', [script, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
test('fingerprint component digests contain no SQL/definition content', () => {
  const dir = mkdtempSync(join(tmpdir(), 'central-digest-test-'));
  try {
    const dest = join(dir, 'categories.sql');
    execute('generate', original, dest);
    const sql = readFileSync(dest, 'utf8');
    assert.match(sql, /WITH category_parts AS \(SELECT jsonb_build_object\(/);
    assert.match(sql, /jsonb_object_agg\(k, md5\(v::text\)\)/);
    assert.doesNotMatch(sql, /SELECT md5\(jsonb_build_object\(/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('only fixed category labels are printed when database digests differ', () => {
  const dir = mkdtempSync(join(tmpdir(), 'central-digest-test-'));
  try {
    const src = join(dir, 'source.json'), dst = join(dir, 'target.json');
    const a = Object.fromEntries(categories.map(k => [k, 'a'.repeat(32)]));
    const b = { ...a, functions: 'b'.repeat(32), policies: 'b'.repeat(32) };
    writeFileSync(src, JSON.stringify(a));
    writeFileSync(dst, JSON.stringify(b));
    assert.equal(execute('compare', src, dst),
      'security_mismatch_categories=policies,functions');
    writeFileSync(dst, '{raw customer data that cannot be parsed');
    assert.equal(execute('compare', src, dst),
      'security_mismatch_categories=diagnostic_unavailable');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ACL diagnostics expose counts and allowlisted schemas only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'central-acl-test-'));
  try {
    const sqlPath = join(dir, 'acls.sql');
    execute('generate-acl', original, sqlPath);
    assert.match(readFileSync(sqlPath, 'utf8'), /payload->'table_grants'/);
    const src = join(dir, 'source-acls.json'), dst = join(dir, 'target-acls.json');
    const secretObject = 'never_print_customer_sensitive_internal_table';
    writeFileSync(src, JSON.stringify([['private', secretObject, 'authenticated', 'SELECT', false]]));
    writeFileSync(dst, JSON.stringify([]));
    const result = execute('compare-acl', src, dst);
    assert.equal(result, 'acl_missing_grants=1\nacl_extra_grants=0\nacl_changed_objects=1\nacl_impacted_schemas=private'.replaceAll('\n', '\n'));
    assert.ok(!result.includes(secretObject));
    assert.ok(!result.includes('authenticated'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
