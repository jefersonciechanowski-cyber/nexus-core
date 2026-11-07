import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const handler = readFileSync(new URL(
  '../supabase/functions/nexus-admin-asaas-production-health/index.ts',
  import.meta.url), 'utf8');
const controls = readFileSync(new URL(
  '../apps/nexus-admin/crm-live-pix-pilot.js', import.meta.url), 'utf8');
const page = readFileSync(new URL(
  '../apps/nexus-admin/crm-live-pix-pilot.html', import.meta.url), 'utf8');
const financialPilot = readFileSync(new URL(
  '../supabase/functions/nexus-admin-crm-live-pix-pilot/index.ts',
  import.meta.url), 'utf8');

test('production API diagnostic is admin MFA2 only and cannot mutate', () => {
  assert.match(handler, /mfa\.getAuthenticatorAssuranceLevel\(accessToken\)/);
  assert.match(handler, /level\?\.currentLevel !== 'aal2'/);
  assert.match(handler, /profile\?\.role !== 'nexus_admin'/);
  assert.match(handler, /profile\.active !== true/);
  assert.match(handler, /userClient\.auth\.getUser\(\)/);
  assert.match(handler, /verify_jwt|Bearer\\s\+/);
  assert.match(handler, /request\.method !== 'POST'/);
  assert.match(handler, /request\.headers\.get\('Origin'\)/);
  assert.match(handler, /Object\.keys\(data\)\.length === 1/);
  assert.match(handler, /Deno\.env\.get\('ASAAS_PRODUCTION_API_KEY'\)/);
  assert.match(handler, /key\.startsWith\('\$aact_prod_'\)/);
  assert.doesNotMatch(handler, /\.from\([^\n]*\)\.(?:insert|update|upsert|delete)\(/);
  assert.doesNotMatch(handler, /method:\s*'PUT'|method:\s*'PATCH'|method:\s*'DELETE'/);
  assert.doesNotMatch(handler, /console\.(?:log|error|warn)/);
});

test('provider requests are fixed GET URLs, and responses hide financial data', () => {
  assert.match(handler, /const ASAAS_BASE = 'https:\/\/api\.asaas\.com\/v3'/);
  assert.match(handler, /'\/myAccount\/status\/'/);
  assert.match(handler, /'\/customers\?limit=1'/);
  assert.match(handler, /'\/payments\?limit=1'/);
  assert.match(handler, /fetch\(ASAAS_BASE \+ path/);
  assert.match(handler, /method: 'GET'/);
  assert.match(handler, /key\.length < 32/);
  assert.match(handler, /result\.body\?\.cancel\(\)/);
  assert.match(handler, /createdCharge: false/);
  assert.doesNotMatch(handler, /JSON\.stringify\(record\)|response\(record/);
  assert.doesNotMatch(handler, /api-sandbox\.asaas\.com/);
});

test('page allows only check while the financial pilot stays hard-off', () => {
  assert.match(financialPilot, /const STAGED_LIVE_PIX_DISABLED = false/);
 assert.match(financialPilot, /const STAGED_LIVE_PIX_CHARGE_DISABLED = true/);
 assert.match(financialPilot, /if \(STAGED_LIVE_PIX_CHARGE_DISABLED\)/);
  assert.match(financialPilot, /if \(STAGED_LIVE_PIX_DISABLED\) return reply/);
  assert.match(page, /id="asaasCheck"/);
  assert.match(controls, /nexus-admin-asaas-production-health/);
  assert.match(controls, /body:\{action:'check'\}/);
  assert.match(controls, /!financeEnabled/);
  assert.match(controls, /await checkAsaasProduction\(\)/);
  assert.doesNotMatch(page, /ASAAS_PRODUCTION_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(controls, /ASAAS_PRODUCTION_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
});
