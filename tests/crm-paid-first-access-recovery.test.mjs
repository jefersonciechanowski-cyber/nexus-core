import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../supabase/functions/nexus-crm-paid-first-access-reconcile/index.ts',import.meta.url),'utf8');
const flow=readFileSync(new URL('../.github/workflows/crm-paid-first-access-reconcile.yml',import.meta.url),'utf8');

test('OIDC auth only permits the exact 15-minute recovery workflow on main',()=>{
  for(const value of [
    "jwtVerify","createRemoteJWKSet","payload.repository===REPO",
    "payload.workflow_ref===WORKFLOW","payload.ref==='refs/heads/main'",
    "payload.ref_type==='branch'",
    "['schedule','workflow_dispatch','push'].includes",
  ])assert.ok(code.includes(value),value);
  assert.match(flow,/id-token: write/);
  assert.match(flow,/audience=nexus-crm-paid-first-access-reconcile/);
  assert.match(flow,/cron:/);
  assert.doesNotMatch(flow,/secrets\./);
});
test('only an already paid and provisioned standard CRM is eligible for retry',()=>{
  for(const value of [
    "NEXUS_CRM_ONBOARDING_EMAIL_FAILED",
    "NEXUS_CRM_ONBOARDING_EMAIL_SENT",
    "NEXUS_CRM_ONBOARDING_EMAIL_RECOVERY_ATTEMPTED",
    "sale.environment!=='production'",
    "sale.sale_status!=='provisioned'",
    "!sale.paid_at","!sale.provisioned_at",
    "product?.code!=='crm'",
    "access.subscription_status!=='active'",
    "access.commercial_condition!=='standard'",
    "access.plan_id!==sale.plan_id",
    "uuid(access.external_tenant_id)",
    "sendCrmAccessEmail(admin,sale,plan,link,sale.provider)",
  ])assert.ok(code.includes(value),value);
  assert.match(code,/Date\.now\(\)-30\*60_000/);
  assert.ok(code.indexOf("audit_attempt_not_persisted")<code.indexOf("recoverUrl(sale,access,secret)"));
});
test('recovery cannot create charges, invoices, tenants or alter paid contract',()=>{
  assert.doesNotMatch(code,/\.from\('organization_product_access'\)\s*\.update\(/);
  assert.doesNotMatch(code,/\.from\('nexus_sales'\)\s*\.update\(/);
  assert.doesNotMatch(code,/api\.asaas\.com|\/paymentLinks|stripe\.checkout\.sessions\.create/);
  assert.doesNotMatch(code,/auth\.admin\.createUser\(/);
  assert.match(code,/NEXUS_CENTRAL_WEBHOOK_SECRET/);
  assert.match(code,/PURPOSE='crm-paid-first-access-recovery-v1'/);
  assert.match(code,/createdCharge:false,createdAccount:false/);
});
