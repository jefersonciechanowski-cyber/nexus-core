import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
 CRM_PUBLIC_ORIGIN,CRM_ASAAS_PUBLIC_ORIGIN,
} from '../supabase/functions/nexus-public-crm-monthly-checkout/contract.mjs';
const asaas=readFileSync(new URL('../supabase/functions/nexus-public-crm-monthly-asaas-production/index.ts',import.meta.url),'utf8');
const stripe=readFileSync(new URL('../supabase/functions/nexus-public-crm-monthly-checkout/index.ts',import.meta.url),'utf8');
const site=readFileSync(new URL('../crm/index.html',import.meta.url),'utf8');
const attributionSql=readFileSync(new URL('../supabase/migrations/20261108190000_crm_asaas_monthly_attribution.sql',import.meta.url),'utf8');

test('Asaas monthly checkout uses published sales origin and never Stripe CRM origin',()=>{
 assert.equal(CRM_ASAAS_PUBLIC_ORIGIN,'https://nexuscore.app.br');
 assert.equal(CRM_PUBLIC_ORIGIN,'https://crm.nexuscore.app.br');
 assert.match(site,/https:\/\/crm\.nexuscore\.app\.br\/site-captacao/);
 assert.match(site,/name="robots" content="noindex,follow"/);
 assert.match(asaas,/request\.headers\.get\('origin'\) !== CRM_ASAAS_PUBLIC_ORIGIN/);
 assert.match(asaas,/return_origin: CRM_ASAAS_PUBLIC_ORIGIN/);
 assert.doesNotMatch(asaas,/\bCRM_PUBLIC_ORIGIN\b/);
 assert.match(stripe,/CRM_PUBLIC_ORIGIN/);
});
test('changing Asaas marketing origin leaves every live-charge safeguard disabled',()=>{
 assert.match(asaas,/const STAGED_ASAAS_PRODUCTION_CHECKOUT_DISABLED = Deno.env.get\('NEXUS_CRM_ASAAS_PROD_RELEASE_APPROVED'\) !== 'true'/);
 assert.ok(asaas.indexOf("if (STAGED_ASAAS_PRODUCTION_CHECKOUT_DISABLED)")<
  asaas.indexOf("if (request.method !== 'POST')"));
 assert.match(asaas,/verifyCheckoutBridgeSignature\(/);
 assert.match(asaas,/NEXUS_CRM_ASAAS_PROD_CHECKOUT_BRIDGE_SECRET/);
 assert.match(asaas,/planIsMonthly\(plan, hiddenTest\)/);
 assert.match(asaas,/preflight_nexus_crm_public_identity/);
 assert.match(asaas,/consume_nexus_public_request_limit/);
 assert.match(asaas,/plan\.price_cents/);
 assert.doesNotMatch(asaas,/TRIAL_ENABLED|NEXUS_CRM_ASAAS_PROD_CHECKOUT_ENABLED = true/);
});

test('signed Asaas CRM checkout preserves campaign source and media without changing organization scope',()=>{
  assert.match(attributionSql,/ALTER TABLE public\.nexus_sales/);
  for(const field of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','referrer_host']){
    assert.ok(attributionSql.includes('ADD COLUMN IF NOT EXISTS '+field+' text'));
  }
  assert.doesNotMatch(attributionSql,/DROP |TRUNCATE |DELETE |DISABLE ROW LEVEL SECURITY|GRANT /i);
  assert.match(asaas,/utm_source: input\.utmSource \|\| null/);
  assert.match(asaas,/utm_medium: input\.utmMedium \|\| null/);
  assert.match(asaas,/utm_campaign: input\.utmCampaign \|\| null/);
  assert.match(asaas,/utm_content: input\.utmContent \|\| null/);
  assert.match(asaas,/utm_term: input\.utmTerm \|\| null/);
  assert.match(asaas,/referrer_host: safeReferrerHost\(input\.referrer\)/);
  assert.match(asaas,/source: 'site-captacao'/);
  assert.match(asaas,/campaign_name: input\.utmCampaign \|\| null/);
  const referrerHelper=asaas.slice(asaas.indexOf('function safeReferrerHost'),asaas.indexOf('async function readJsonLimited'));
  assert.match(referrerHelper,/return url\.hostname\.toLowerCase\(\)/);
  assert.doesNotMatch(referrerHelper,/url\.search|url\.href|url\.pathname/);
});
