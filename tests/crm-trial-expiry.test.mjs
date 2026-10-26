import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql=readFileSync(new URL('../docs/CRM_TRIAL_CLAIM_SQL_DRAFT.sql',import.meta.url),'utf8');
const worker=readFileSync(new URL('../supabase/functions/nexus-crm-trial-reconcile/index.ts',import.meta.url),'utf8');

test('expiry RPC requires the exact trial, end date, provider-null and claim',()=>{
  for(const pattern of [
    /expire_nexus_crm_trial_access/,/for update/,/v_access\.renews_at is distinct from p_expected_end/,
    /v_access\.renews_at > current_date/,/v_access\.subscription_status <> 'trial'/,
    /v_access\.access_status <> 'active'/,/v_access\.billing_provider is not null/,
    /v_access\.commercial_condition <> 'standard'/,/v_access\.contracted_price_cents <> 0/,
    /p\.code='crm'/,/c\.state='provisioned'/,/access_status='suspended'/,
    /subscription_status='past_due'/,/last_payment_status='trial_expired'/,
    /grant execute on function public\.expire_nexus_crm_trial_access/,
  ]) assert.match(sql,pattern);
  assert.doesNotMatch(sql,/\bupdate\s+public\.organizations/i);
  assert.doesNotMatch(sql,/\bupdate\s+public\.nexus_payments/i);
});

test('worker requires GitHub OIDC, separate audience, main branch and feature gate',()=>{
  for(const re of [
    /NEXUS_CRM_TRIAL_RECONCILE_ENABLED/,
    /createRemoteJWKSet/,/jwtVerify/,
    /audience:'nexus-crm-trial-reconcile'/,
    /payload\.repository!=='jefersonciechanowski-cyber\/nexus-core'/,
    /payload\.ref!=='refs\/heads\/main'/,
    /'schedule','workflow_dispatch'/,
    /eq\('product_id',product\.id\)/,
    /eq\('subscription_status','trial'\)/,
    /eq\('commercial_condition','standard'\)/,
    /is\('billing_provider',null\)/,
    /eq\('contracted_price_cents',0\)/,
    /rpc\('expire_nexus_crm_trial_access'/,
    /syncCrmEntitlement\(/,
  ]) assert.match(worker,re);
  assert.doesNotMatch(worker,/stripe\.checkout|asaas\.com|provisionCrmTenant|createUser|grantCourtesy/);
});

test('reservation SQL is not deployed by branch content',()=>{
  assert.match(sql,/REVIEW ONLY/);
  assert.match(sql,/Do not apply to production/);
});
