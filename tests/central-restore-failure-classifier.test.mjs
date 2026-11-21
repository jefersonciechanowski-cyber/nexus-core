import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/classify-central-restore-error.py', import.meta.url));
function run(log) {
  const dir = mkdtempSync(join(tmpdir(), 'central-error-test-'));
  try {
    const file = join(dir, 'restore.log');
    writeFileSync(file, log, { mode: 0o600 });
    const result = spawnSync('python3', [script, file], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('categorizes missing extension without exposing SQL', () => {
  const privateData = 'private-customer-email@example.invalid';
  const got = run('pg_restore: error: could not execute query: ERROR: extension "supabase_vault" is not available\\nSQL: ' + privateData);
  assert.equal(got, 'restore_failure_class=extension_unavailable');
  assert.ok(!got.includes(privateData));
});

test('categorizes missing function without emitting object identifiers', () => {
  assert.equal(run('pg_restore: error: could not execute query: ERROR: function extensions.secret_fn() does not exist'), 'restore_failure_class=missing_function');
});

test('unknown restore errors never echo SQL or secrets', () => {
  const got = run('pg_restore: error: failing SQL with SECRET-PRIVATE-123');
  assert.equal(got, 'restore_failure_class=unknown_restore_error');
});
