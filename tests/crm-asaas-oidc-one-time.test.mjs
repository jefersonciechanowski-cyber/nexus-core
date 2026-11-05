import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-readonly-once/index.ts',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../.github/workflows/crm-asaas-sandbox-readonly.yml',import.meta.url),'utf8');

test('verification is OIDC-signed for one workflow and the main branch only',()=>{
  assert.match(source,/jwtVerify\(auth\.slice\(7\),jwks/);
  assert.match(source,/issuer:'https:\/\/token\.actions\.githubusercontent\.com'/);
  assert.match(source,/audience:AUDIENCE/);
  assert.match(source,/payload\.repository!==REPO/);
  assert.match(source,/payload\.workflow_ref!==WORKFLOW/);
  assert.match(source,/payload\.event_name!=='push'/);
  assert.match(source,/payload\.ref!=='refs\/heads\/main'/);
  assert.match(source,/Date\.now\(\)>=EXPIRES/);
  assert.match(workflow,/id-token: write/);
  assert.match(workflow,/branches: \[main\]/);
  assert.match(workflow,/\.github\/workflows\/crm-asaas-sandbox-readonly\.yml/);
  assert.doesNotMatch(workflow,/workflow_dispatch|schedule:/);
});

test('never rotates or discloses the existing internal secret',()=>{
  assert.match(source,/Deno\.env\.get\('NEXUS_CRM_ASAAS_VERIFY_SECRET'\)/);
  assert.match(source,/x-nexus-central-internal-key':secret/);
  assert.doesNotMatch(source,/console\.|\.setSecret\(|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(workflow,/secrets\.|ASAAS_SANDBOX_API_KEY|NEXUS_CRM_ASAAS_VERIFY_SECRET/);
  assert.match(workflow,/ACTIONS_ID_TOKEN_REQUEST_URL/);
});

test('only probes one already-recorded Sandbox event, without reserve or provision',()=>{
  assert.match(source,/eventId:EVENT,reserve:false/);
  assert.match(source,/body\.trim\(\)!=='\{\}'/);
  assert.match(source,/api-sandbox|nexus-crm-asaas-verify-event/);
  assert.match(source,/NEXUS_CRM_ASAAS_VERIFY_ENABLED/);
  assert.match(source,/NEXUS_CRM_ASAAS_MONTHLY_MODE/);
  assert.match(source,/readOnly:true/);
  assert.match(source,/result\.canActivateCrm!==false/);
  assert.doesNotMatch(source,/\.rpc\(|\.from\(|\.insert\(|\.update\(|\.delete\(|createClient\(/);
  assert.doesNotMatch(source,/nexus-crm-asaas-provision|nexus-public-crm-monthly-checkout|paymentLinks\//);
});
