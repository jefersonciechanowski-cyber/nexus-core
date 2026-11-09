import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src=readFileSync(new URL('../supabase/functions/nexus-crm-public-release-preflight/index.ts',import.meta.url),'utf8');
const flow=readFileSync(new URL('../.github/workflows/crm-public-release-smoke.yml',import.meta.url),'utf8');

test('preflight requires a short-lived OIDC token from this reviewed main-branch workflow',()=>{
  for(const text of [
    'createRemoteJWKSet','jwtVerify',
    'https://token.actions.githubusercontent.com',
    "audience:AUDIENCE",
    "payload.repository===REPO","payload.workflow_ref===WORKFLOW",
    "payload.ref==='refs/heads/main'","payload.ref_type==='branch'",
    "if(!(await authorized(request)))",
    "if(request.method!=='GET')",
  ])assert.ok(src.includes(text),text);
  assert.match(src,/error:'unauthorized'/);
  assert.match(src,/cache-control':'no-store'/);
});
test('only boolean flag and secret configuration readiness is returned',()=>{
  for(const value of [
    'NEXUS_CRM_TRIAL_FINGERPRINT_SECRET',
    'NEXUS_CRM_PUBLIC_TRIAL_READY',
    'NEXUS_CRM_TRIAL_RECONCILE_ENABLED',
    'NEXUS_CRM_TRIAL_EXPIRY_SCHEDULE_CONFIRMED',
    'NEXUS_CRM_ASAAS_PROD_ANNUAL_RELEASE_APPROVED',
    'NEXUS_CRM_ASAAS_PROD_ANNUAL_SETTLEMENT_READY',
    'NEXUS_CRM_ASAAS_PROD_ANNUAL_WORKER_READY',
    'NEXUS_CRM_ASAAS_PROD_ANNUAL_EXPIRY_ENABLED',
  ])assert.ok(src.includes(value),value);
  assert.match(src,/createdCharge:false,createdAccount:false/);
  assert.match(src,/sentEmail:false,customerDataRead:false/);
  for(const key of ['BREVO_CRM_SMTP_USER','BREVO_CRM_SMTP_KEY','BREVO_CRM_SMTP_HOST','BREVO_CRM_SMTP_PORT','BREVO_FROM_EMAIL'])assert.ok(src.includes(key),key);
  assert.doesNotMatch(src,/env\.BREVO_SMTP_/);
  assert.doesNotMatch(src,/createClient\(|\.from\(|fetch\('https:\/\/api\.asaas|console\.(log|info|warn|error)\(/);
  assert.doesNotMatch(src,/JSON\.stringify\(env\)|JSON\.stringify\(Deno\.env\.toObject/);
});
test('workflow uses GitHub OIDC only on main; no credentials or customer form submissions',()=>{
  assert.match(flow,/id-token: write/);
  assert.match(flow,/audience=nexus-crm-public-release-preflight/);
  assert.match(flow,/nexus-crm-public-release-preflight/);
  assert.match(flow,/github\.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(flow,/secrets\.|ASAAS_PRODUCTION_API_KEY=|SUPABASE_SERVICE_ROLE_KEY=/);
});
