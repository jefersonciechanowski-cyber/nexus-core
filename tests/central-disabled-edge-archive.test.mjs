import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const names = [
  'nexus-part1-billing-acceptance',
  'nexus-part3-ordering-acceptance',
  'nexus-crm-stripe-test-webhook',
  'nexus-crm-billing-acceptance-step',
  'nexus-crm-billing-acceptance-run',
  'nexus-crm-entitlement-diagnostic-once',
  'nexus-public-crm-sales-test',
  'nexus-crm-billing-acceptance-once',
];

test('all temporary Central test endpoints recovered from production remain disabled', () => {
  for (const slug of names) {
    const file = new URL('../supabase/functions/' + slug + '/index.ts', import.meta.url);
    const source = readFileSync(file, 'utf8');
    assert.match(source, /status: 410/);
    assert.match(source, /cache-control': 'no-store'/);
    assert.match(source, /desativado/);
    assert.doesNotMatch(source, /Deno\.env|fetch\(|createClient|process\.env|POSTGRES|SUPABASE_SERVICE_ROLE_KEY|ASAAS/);
  }
});
