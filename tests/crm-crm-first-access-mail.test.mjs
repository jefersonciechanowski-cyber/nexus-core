import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const crm=readFileSync(new URL('../supabase/functions/stripe-webhook/crm-provisioning.ts',import.meta.url),'utf8');
const sales=readFileSync(new URL('../supabase/functions/_shared/nexus-sale-provisioning.ts',import.meta.url),'utf8');
const stripe=readFileSync(new URL('../supabase/functions/stripe-webhook/index.ts',import.meta.url),'utf8');

test('new paid CRM customers use the isolated Brevo key across Stripe and Asaas',()=>{
 assert.match(crm,/Deno\.env\.get\('BREVO_CRM_API_KEY'\)/);
 assert.doesNotMatch(crm,/Deno\.env\.get\('BREVO_API_KEY'\)/);
 assert.match(crm,/billingProvider: 'stripe' \| 'asaas' = 'stripe'/);
 assert.match(crm,/billing_provider: billingProvider/);
 assert.match(sales,/sendCrmAccessEmail\(admin, sale, plan, crmProvision\.firstAccessUrl, provider\)/);
 assert.match(stripe,/sendCrmAccessEmail\(admin, sale, plan, crmProvision\.firstAccessUrl\)/);
});
test('first access must be trusted CRM URL and no secret is logged',()=>{
 assert.match(crm,/accessUrl\.origin !== 'https:\/\/crm\.nexuscore\.app\.br'/);
 assert.match(crm,/accessUrl\.pathname !== '\/auth\/primeiro-acesso'/);
 assert.match(crm,/href="\$\{safeAccessUrl\}"/);
 assert.match(crm,/brevo_http_/);
 assert.match(crm,/brevo_request_failed/);
 assert.doesNotMatch(crm,/Brevo \$\{response\.status\}: \$\{clean\(await response\.text\(\)/);
 assert.match(crm,/NEXUS_CRM_ONBOARDING_EMAIL_SENT/);
 assert.match(crm,/\.eq\('entity_id', sale\.id\)/);
 assert.match(crm,/\/v3\/smtp\/email/);
 assert.match(crm,/signal: AbortSignal\.timeout\(12000\)/);
});
test('payment confirmation is independent from email delivery and never charges',()=>{
 assert.match(crm,/Leave paid provisioned access intact on audit downtime/);
 assert.match(sales,/await sendCrmAccessEmail\(/);
 assert.doesNotMatch(crm,/\/v3\/payments|\/v3\/subscriptions|stripe\.checkout\.sessions\.create/);
});
