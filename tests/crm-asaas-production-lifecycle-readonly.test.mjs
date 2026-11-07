import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-production-lifecycle-preview/index.ts',import.meta.url),'utf8');
const sandbox=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-lifecycle-preview/index.ts',import.meta.url),'utf8');
const pure=readFileSync(new URL('../supabase/functions/_shared/crm-asaas-production-review.mjs',import.meta.url),'utf8');

test('live Asaas renewal/cancellation review is hard off BEFORE provider/DB access',()=>{
 const guard=src.indexOf('if(STAGED_ASAAS_PROD_LIFECYCLE_DISABLED)');
 const source=src.indexOf('const STAGED_ASAAS_PROD_LIFECYCLE_DISABLED = true');
 const db=src.indexOf("admin.from('nexus_crm_asaas_production_events')");
 const api=src.indexOf("fetch('https://api.asaas.com/v3'+path");
 assert.ok(source>=0&&guard>source&&db>guard&&api>db);
 assert.match(src,/NEXUS_CRM_ASAAS_PROD_LIFECYCLE_PREVIEW_ENABLED/);
 assert.match(src,/NEXUS_CRM_ASAAS_PROD_WEBHOOK_CONFIRMED/);
 assert.match(src,/NEXUS_CRM_ASAAS_PROD_LIFECYCLE_PREVIEW_SECRET/);
 assert.match(src,/NEXUS_CRM_ASAAS_PROD_WORKER_SECRET/);
 assert.match(src,/trustedAsaasToken\(/);
 assert.doesNotMatch(src,/api-sandbox\.asaas\.com|ASAAS_SANDBOX_API_KEY/);
});

test('production preview requires same company, CRM access, subscription and receipt',()=>{
 assert.match(src,/\.eq\('provider_subscription_id',subscriptionId\)\.eq\('billing_provider','asaas'\)/);
 assert.match(src,/\.eq\('organization_id',access\.organization_id\)\.eq\('product_id',access\.product_id\)/);
 assert.match(src,/\.eq\('provider','asaas'\)\.eq\('environment','production'\)/);
 assert.match(src,/\.eq\('access_id',access\.id\)\.eq\('organization_id',access\.organization_id\)/);
 assert.match(src,/payment_not_in_verified_ledger/);
 assert.match(src,/previewProductionCrmAsaasLifecycle\(\{/);
 assert.match(pure,/environment:'production'/);
 assert.match(pure,/readOnly: true, canActivateCrm: false/);
});

test('preview only uses independently authenticated GET; never charges, updates or grants',()=>{
 assert.match(src,/method:'GET'/);
 assert.match(src,/https:\/\/api\.asaas\.com\/v3/);
 assert.match(src,/ASAAS_PRODUCTION_API_KEY/);
 assert.match(src,/asaasKey\.startsWith\('\$aact_prod_'\)/);
 assert.match(src,/AbortSignal\.timeout\(8000\)/);
 assert.doesNotMatch(src,/admin\.rpc\(|\.insert\(|\.update\(|\.delete\(|POST.*payment|provisionSaleForProvider/);
 assert.match(src,/readOnly:true,canActivateCrm:false/);
 assert.match(sandbox,/NEXUS_CRM_ASAAS_MONTHLY_MODE/);
 assert.match(sandbox,/https:\/\/api-sandbox\.asaas\.com\/v3/);
});
