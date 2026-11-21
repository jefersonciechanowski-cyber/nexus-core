import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql = readFileSync(new URL('../scripts/central-restore-integrity.sql', import.meta.url), 'utf8');
const runner = readFileSync(new URL('../scripts/verify-central-restore.sh', import.meta.url), 'utf8');
test('restore checker is read-only and covers contract, user and account links', () => {
  assert.match(sql, /BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(sql, /COMMIT;/);
  for (const name of ['nexus_accounts', 'nexus_account_users', 'organization_product_access',
    'organization_memberships', 'nexus_payments', 'auth.users']) {
    assert.ok(sql.includes(name), 'missing table ' + name);
  }
  for (const name of ['account_org_link_missing', 'account_user_link_missing', 'access_ref_missing',
    'subscription_status:', 'access_status:']) assert.ok(sql.includes(name));
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|CREATE)\s+(?:TABLE|FROM|INTO|public|auth)\b/i);
});
test('offline wrapper restricts access to a verified localhost restoration', () => {
  assert.match(runner, /NEXUS_ISOLATED_RESTORE/);
  assert.match(runner, /RESTORE_DB_URL/);
  assert.match(runner, /localhost/);
  assert.match(runner, /127\.0\.0\.1/);
  assert.match(runner, /Blocked: only localhost/);
  assert.match(runner, /command -v psql/);
  assert.match(runner, /ON_ERROR_STOP=1/);
});
