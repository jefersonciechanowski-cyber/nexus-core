import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const live=readFileSync(new URL('../supabase/functions/nexus-public-crm-monthly-asaas-production/index.ts',import.meta.url),'utf8');
const sandbox=readFileSync(new URL('../supabase/functions/nexus-public-crm-monthly-asaas/index.ts',import.meta.url),'utf8');
const contract=readFileSync(new URL('../supabase/functions/_shared/crm-asaas-monthly-contract.mjs',import.meta.url),'utf8');

test('production checkout remains fail-closed before any external operation unless released',()=>{
 const define=live.indexOf("const STAGED_ASAAS_PRODUCTION_CHECKOUT_DISABLED = Deno.env.get('NEXUS_CRM_ASAAS_PROD_RELEASE_APPROVED') !== 'true'");
 const guard=live.indexOf('if (STAGED_ASAAS_PRODUCTION_CHECKOUT_DISABLED)');
 const hmac=live.indexOf('verifyCheckoutBridgeSignature(');
 const db=live.indexOf('createClient(supabaseUrl, serviceKey');
 const provider=live.indexOf("fetch('https://api.asaas.com/v3/paymentLinks'");
 assert.ok(define>=0&&guard>define&&hmac>guard&&db>hmac&&provider>db);
 assert.match(live,/NEXUS_CRM_ASAAS_PROD_CHECKOUT_ENABLED/);
 assert.match(live,/NEXUS_CRM_ASAAS_PROD_SETTLEMENT_READY/);
 assert.match(live,/NEXUS_CRM_ASAAS_PROD_WEBHOOK_CONFIRMED/);
 assert.match(live,/NEXUS_CRM_ASAAS_PROD_CHECKOUT_BRIDGE_SECRET/);
});
test('production API key and HTTPS link domains are isolated from sandbox',()=>{
 assert.match(live,/Deno\.env\.get\('ASAAS_PRODUCTION_API_KEY'\)/);
 assert.match(live,/asaasKey\.startsWith\('\$aact_prod_'\)/);
 assert.match(live,/fetch\('https:\/\/api\.asaas\.com\/v3\/paymentLinks'/);
 assert.match(live,/!\['www\.asaas\.com','asaas\.com'\]\.includes\(url\.hostname\)/);
 assert.match(live,/url\.protocol !== 'https:' \|\| url\.username \|\| url\.password \|\| url\.port/);
 assert.doesNotMatch(live,/api-sandbox\.asaas\.com|ASAAS_SANDBOX_API_KEY|NEXUS_CRM_ASAAS_SANDBOX_E2E_ENABLED/);
 assert.match(sandbox,/NEXUS_CRM_ASAAS_SANDBOX_E2E_ENABLED/);
 assert.doesNotMatch(sandbox,/https:\/\/api\.asaas\.com\/v3|ASAAS_PRODUCTION_API_KEY/);
});
test('no anonymous double charge or fraudulent amount, courtesy, trial and cross-provider',()=>{
 assert.match(live,/verifyCheckoutBridgeSignature\(/);
 assert.match(live,/consume_nexus_public_request_limit/);
 assert.match(live,/preflight_nexus_crm_public_identity/);
 assert.match(live,/if \(existingOrg\?\.id\)/);
 assert.match(live,/const hiddenTest = false/);
 assert.match(live,/planIsMonthly\(plan, hiddenTest\)/);
 assert.match(live,/checkout_amount_cents: Number\(plan\.price_cents\)/);
 assert.match(live,/provider: 'asaas', environment: 'production'/);
 assert.match(live,/buildCrmAsaasRecurringLink\(\{ plan, method, saleId: sale\.id \}\), limit: 1/);
 assert.match(live,/checkout_created','paid','provisioned'/);
 assert.doesNotMatch(live,/\.eq\('provider','asaas'\)/);
 assert.match(live,/sale_status: 'checkout_created',\n      last_error: 'Resultado do link Asaas requer conciliação manual/);
 assert.match(contract,/chargeType: 'RECURRENT'/);
 assert.match(contract,/subscriptionCycle: 'MONTHLY'/);
 assert.match(contract,/allowedMethods = new Set\(\['PIX','BOLETO'\]\)/);
 assert.doesNotMatch(live,/grantCourtesy|provisionSaleForProvider|sendCrmAccessEmail|syncCrmEntitlement/);
});
test('provider errors cannot log secrets or create a second link after an unknown result',()=>{
 assert.match(live,/console\.error\('crm-asaas-checkout-unknown', 'requires_manual_reconciliation'\)/);
 assert.match(live,/asaas-create-link-rejected/);
 assert.doesNotMatch(live,/console\.(log|error|warn)\(.*(?:asaasKey|serviceKey|bridgeKey|upstream\.text|input\.email)/);
 assert.doesNotMatch(live,/\/v3\/payments|\/v3\/subscriptions|\/v3\/customers/);
});
