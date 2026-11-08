import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const annual=readFileSync(new URL("../supabase/functions/nexus-public-crm-annual-bf-asaas-production/index.ts",import.meta.url),"utf8");
const monthly=readFileSync(new URL("../supabase/functions/nexus-public-crm-monthly-asaas-production/index.ts",import.meta.url),"utf8");
const provisioner=readFileSync(new URL("../supabase/functions/nexus-crm-asaas-production-provision/index.ts",import.meta.url),"utf8");

test("Annual endpoint has independent hard off before any DB/provider side effect",()=>{
 assert.match(annual,/STAGED_ANNUAL_DISABLED = Deno\.env\.get\('NEXUS_CRM_ASAAS_PROD_ANNUAL_RELEASE_APPROVED'\) !== 'true'/);
 assert.match(annual,/NEXUS_CRM_ASAAS_PROD_ANNUAL_SETTLEMENT_READY/);
 assert.match(annual,/NEXUS_CRM_ASAAS_PROD_ANNUAL_WORKER_READY/);
 assert.ok(annual.indexOf('if (STAGED_ANNUAL_DISABLED)')<annual.indexOf("createClient(supabaseUrl, serviceKey"));
 assert.ok(annual.indexOf('if (STAGED_ANNUAL_DISABLED)')<annual.indexOf("fetch('https://api.asaas.com/v3/paymentLinks'"));
 assert.doesNotMatch(annual,/NEXUS_CRM_ASAAS_PROD_ANNUAL_RELEASE_APPROVED'\) === 'true'/);
});
test("Annual checkout is prepaid 12 months, price computed server side",()=>{
 assert.match(annual,/billing_mode: 'prepaid'/);
 assert.match(annual,/billing_cycle_months: 12/);
 assert.match(annual,/checkout_amount_cents: quoteCrmBlackFridayAnnual\(plan\)\.annualAmountCents/);
 assert.match(annual,/buildCrmAsaasBlackFridayAnnualLink/);
 assert.match(annual,/verifyCheckoutBridgeSignature/);
 assert.match(annual,/preflight_nexus_crm_public_identity/);
 const annualLink = readFileSync(new URL("../supabase/functions/_shared/crm-asaas-black-friday-annual-contract.mjs",import.meta.url),"utf8");
 assert.match(annualLink,/chargeType: 'DETACHED'/);
 assert.match(annual,/return reply\(\{ link, checkoutId: linkId, annualPrepaid: true, months: 12/);
 assert.match(annual,/if \(recent\?\.id\)/);
 assert.match(annual,/sale_status: 'checkout_created'/);
 assert.doesNotMatch(annual,/provider: 'stripe'|checkout\.stripe\.com/);
});
test("Monthly checkout and worker remain monthly and cannot silently process prepaid annual money",()=>{
 assert.match(monthly,/buildCrmAsaasRecurringLink/);
 assert.match(monthly,/billing_mode: 'recurring'/);
 assert.match(monthly,/billing_cycle_months: 1/);
 assert.match(provisioner,/previewProductionCrmAsaasPayment/);
 const reviewer=readFileSync(new URL("../supabase/functions/_shared/crm-asaas-production-review.mjs",import.meta.url),"utf8");
 assert.match(reviewer,/sale\?\.billing_mode !== 'recurring'/);
 assert.match(reviewer,/sale\?\.billing_cycle_months !== 1/);
});
