import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const worker = readFileSync(new URL('../supabase/functions/nexus-billing-reconcile/index.ts', import.meta.url), 'utf8');
const sql = readFileSync(new URL('../supabase/migrations/20261107170000_crm_asaas_prepaid_expiry.sql', import.meta.url), 'utf8');
const spec = readFileSync(new URL('sql/crm_asaas_prepaid_expiry_assertions.sql', import.meta.url), 'utf8');

test('default-off Asaas prepaid gate is after GitHub OIDC and never creates invoices', () => {
  const auth = worker.indexOf("audience: 'nexus-billing-reconcile'");
  const gate = worker.indexOf("if (summary.asaas_prepaid_gate === 'enabled')");
  assert.ok(auth >= 0 && gate > auth);
  assert.match(worker,/NEXUS_CRM_ASAAS_PREPAID_EXPIRY_ENABLED/);
  assert.match(worker,/\.eq\('billing_provider', 'asaas'\)/);
  assert.match(worker,/\.eq\('billing_mode', 'prepaid'\)/);
  assert.match(worker,/\.lt\('renews_at', today\)/);
  assert.match(worker,/admin\.rpc\('expire_nexus_crm_asaas_prepaid_access'/);
  assert.match(worker,/syncCrmEntitlement\(admin, access\.id, undefined, nowIso, true\)/);
  assert.doesNotMatch(sql,/https:\/\/api\.asaas\.com|create.*payment|POST\s+.*payments/i);
});

test('service-only RPC checks dated paid CRM contract and remains idempotent', () => {
  assert.match(sql,/security invoker/);
  assert.match(sql,/for update/);
  assert.match(sql,/v_access\.billing_provider is distinct from 'asaas'/);
  assert.match(sql,/v_access\.commercial_condition is distinct from 'standard'/);
  assert.match(sql,/v_access\.billing_mode is distinct from 'prepaid'/);
  assert.match(sql,/v_access\.renews_at >= v_today/);
  assert.match(sql,/pay\.provider_status = 'RECEIVED'/);
  assert.match(sql,/pay\.access_id = v_access\.id/);
  assert.match(sql,/pay\.organization_id = v_access\.organization_id/);
  assert.match(sql,/v_access\.provider_subscription_id is not null/);
  assert.match(sql,/revoke all on function public\.expire_nexus_crm_asaas_prepaid_access\(uuid\)/);
  assert.match(sql,/grant execute on function public\.expire_nexus_crm_asaas_prepaid_access\(uuid\)/);
  assert.match(spec,/already_suspended/);
  assert.match(spec,/paid_receipt_not_verified/);
  assert.match(spec,/courtesy contract suspended/);
  assert.match(spec,/future contract suspended/);
});
