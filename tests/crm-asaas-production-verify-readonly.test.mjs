import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-production-verify/index.ts',import.meta.url),'utf8');
const reviewed=readFileSync(new URL('../supabase/functions/_shared/crm-asaas-production-review.mjs',import.meta.url),'utf8');
const prodInbox=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-production-events/index.ts',import.meta.url),'utf8');
const sandbox=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-verify-event/index.ts',import.meta.url),'utf8');

test('production read-only verifier is hard-off before any database or Asaas GET',()=>{
 const guarded=src.indexOf('if(STAGED_PRODUCTION_VERIFY_DISABLED)');
 const start=src.indexOf('const STAGED_PRODUCTION_VERIFY_DISABLED = Deno.env.get('NEXUS_CRM_ASAAS_PROD_RELEASE_APPROVED') !== 'true'');
 const database=src.indexOf("admin.from('nexus_crm_asaas_production_events')");
 const provider=src.indexOf("fetch('https://api.asaas.com/v3'+path");
 assert.ok(start>=0&&guarded>start&&database>guarded&&provider>database);
 assert.match(src,/NEXUS_CRM_ASAAS_PROD_VERIFY_ENABLED/);
 assert.match(src,/NEXUS_CRM_ASAAS_PROD_VERIFY_SECRET/);
 assert.match(src,/NEXUS_CRM_ASAAS_PROD_EVENTS_TOKEN/);
 assert.match(src,/trustedAsaasToken\(/);
 assert.doesNotMatch(src,/NEXUS_CRM_ASAAS_VERIFY_SECRET|ASAAS_SANDBOX_API_KEY/);
});

test('production verifier never grants, charges, claims or logs payment data',()=>{
 assert.match(src,/previewProductionCrmAsaasPayment\(\{/);
 assert.match(src,/readOnly:true/);
 assert.match(src,/canActivateCrm:false/);
 assert.match(src,/independentlyVerified:result\.decision==='verified_for_review'/);
 assert.doesNotMatch(src,/admin\.rpc\(|\.update\(|\.insert\(|\.delete\(|sendCrm|provisionCrm|\/v3\/paymentLinks',\s*\{\s*method:'POST'/);
 assert.doesNotMatch(src,/console\.|JSON\.stringify\(event\)|JSON\.stringify\(sale\)/);
 assert.match(reviewed,/readOnly: true, canActivateCrm: false/);
});

test('fetch is fixed to Asaas production GET with bounded body and protected IDs',()=>{
 assert.match(src,/ASAAS_PRODUCTION_API_KEY/);
 assert.match(src,/asaasKey\.startsWith\('\$aact_prod_'\)/);
 assert.match(src,/https:\/\/api\.asaas\.com\/v3/);
 assert.match(src,/method:'GET'/);
 assert.match(src,/AbortSignal\.timeout\(8000\)/);
 assert.match(src,/text\.length>30000/);
 assert.match(src,/new RegExp\('\^'\+prefix\+/);
 assert.match(src,/const linkedByLink=typeof linkId==='string'/);
 assert.match(src,/saleQuery\.eq\('asaas_checkout_id',linkId\)/);
 assert.match(src,/\.eq\('environment','production'\)/);
 assert.match(src,/saleQuery\.limit\(2\)/);
 assert.doesNotMatch(src,/https:\/\/api-sandbox\.asaas\.com/);
});

test('production events inbox and sandbox remain isolated and code-disabled',()=>{
 assert.match(prodInbox,/NEXUS_CRM_ASAAS_PROD_EVENTS_RECEIVE_ONLY_ENABLED/);
 assert.match(prodInbox,/NEXUS_CRM_ASAAS_PROD_EVENTS_ENABLED/);
 assert.doesNotMatch(prodInbox,/admin\.rpc\(|sendCrmAccessEmail|provisionSaleForProvider/);
 assert.match(sandbox,/NEXUS_CRM_ASAAS_MONTHLY_MODE'\) !== 'sandbox'/);
 assert.match(sandbox,/https:\/\/api-sandbox\.asaas\.com\/v3/);
 assert.doesNotMatch(sandbox,/nexus_crm_asaas_production_events/);
});
