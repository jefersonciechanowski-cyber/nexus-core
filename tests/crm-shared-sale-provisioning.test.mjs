import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const shared=readFileSync(new URL('../supabase/functions/_shared/nexus-sale-provisioning.ts',import.meta.url),'utf8');
const stripe=readFileSync(new URL('../supabase/functions/stripe-webhook/index.ts',import.meta.url),'utf8');
const crm=readFileSync(new URL('../supabase/functions/stripe-webhook/crm-provisioning.ts',import.meta.url),'utf8');
const draft=readFileSync(new URL('../docs/CRM_ASAAS_PAYMENT_CLAIM_SQL_DRAFT.sql',import.meta.url),'utf8');

test('Stripe dedicated webhook verifies signature and paid session before CRM provisioning',()=>{
  // Stripe now has a dedicated provisioner. Shared Asaas is a DIFFERENT,
  // lease-gated path; asserting the old Stripe import would be misleading.
  assert.match(stripe,/stripe\.webhooks\.constructEventAsync\(rawBody, signature, webhookSecret/);
  assert.match(stripe,/if \(event\.livemode && !livePaymentsEnabled\(\)\)/);
  assert.match(stripe,/const paid = !expired && session\.payment_status === 'paid'/);
  assert.match(stripe,/const crmProvision = await provisionCrmTenant\(admin, sale, access\)/);
  assert.match(stripe,/await sendCrmAccessEmail\(admin, sale, plan, crmProvision\.firstAccessUrl\)/);
  assert.match(stripe,/syncCrmEntitlement/);
  assert.match(shared,/export async function provisionSaleForProvider/);
  for(const str of [
    "sale.source === 'portal-pilot-upgrade'",
    "existingAccess?.subscription_status === 'trial'",
    "existingPlan?.code === 'piloto'",
    'alreadyConvertedPilotAccess',
    'NEXUS_PILOT_CONVERTED',
    "plan.employee_limit && Number(activeEmployeeCount || 0) > Number(plan.employee_limit)",
    'sendPilotConversionEmail',
  ]) assert.ok(shared.includes(str),str);
  assert.match(crm,/billingProvider: 'stripe' \| 'asaas' = 'stripe'/);
  assert.match(shared,/sendCrmAccessEmail\(admin, sale, plan, crmProvision\.firstAccessUrl, provider\)/);
});

test('Asaas sandbox and production cannot provision from webhook without verified lease',()=>{
  assert.match(shared,/saleInput\?\.provider !== 'asaas'/);
  assert.match(shared,/!\['sandbox','production'\]\.includes\(asaasEnvironment\)/);
  assert.match(shared,/saleInput\?\.environment !== asaasEnvironment/);
  assert.match(shared,/saleInput\?\.source !== 'site-captacao'/);
  assert.match(shared,/saleInput\?\.billing_mode !== 'recurring'/);
  assert.match(shared,/saleInput\?\.billing_cycle_months !== 1/);
  assert.match(shared,/saleInput\?\.sale_status !== 'paid'/);
  assert.match(shared,/!saleInput\?\.paid_at/);
  assert.match(shared,/!context\.subscriptionId/);
  assert.match(shared,/!context\.paymentId/);
  assert.match(shared,/!context\.customerId/);
  assert.match(shared,/const verifiedTable=asaasEnvironment==='production'/);
  assert.match(shared,/nexus_crm_asaas_production_verified_payments/);
  assert.match(shared,/nexus_crm_asaas_verified_payments/);
  assert.match(shared,/\.from\(verifiedTable\)/);
  assert.match(shared,/\.eq\('decision', 'provisioning'\)/);
  assert.match(shared,/\.eq\('registration_number', saleInput\.registration_number\)/);
  assert.match(shared,/if \(linkedOrgError \|\| linkedOrg\?\.id\)/);
  // A new company cannot automatically adopt an existing login or courtesy.
  assert.match(shared,/if \(provider === 'asaas'\) \{\s*await admin\.from\('nexus_sales'\)\.update\(\{\s*sale_status: 'manual_review'/);
  assert.match(shared,/E-mail já cadastrado; requer vinculação manual/);
  assert.match(shared,/Contrato CRM existente; nenhuma alteração realizada/);
  assert.ok(shared.indexOf("if (provider === 'asaas') {",shared.indexOf("createError ||")) <
    shared.indexOf("auth.admin.listUsers"));
  // The lease and company collision check are BEFORE creating the user.
  assert.ok(shared.indexOf("eq('decision', 'provisioning')") <
    shared.indexOf("auth.admin.createUser"));
  assert.ok(shared.indexOf("if (linkedOrgError || linkedOrg?.id)") <
    shared.indexOf("auth.admin.createUser"));
  assert.match(shared,/recordVerifiedCrmAsaasPayment/);
});

test('SQL claim is a DRAFT and cannot be executed by browser roles',()=>{
  assert.match(draft,/REVIEW ONLY \/ NOT APPLIED/);
  assert.match(draft,/security definer set search_path = ''/);
  assert.match(draft,/revoke all on function public\.claim_nexus_crm_asaas_provisioning/);
  assert.match(draft,/to service_role/);
  assert.match(draft,/where provider_payment_id=p_provider_payment_id and sale_id=p_sale_id\s+for update/);
  assert.match(draft,/v_reservation\.decision <> 'verified_pending_provisioning'/);
  assert.match(draft,/sale_status='paid'/);
  assert.match(draft,/decision='provision_ready'/);
  assert.match(draft,/from auth\.users/);
  assert.match(draft,/from public\.organizations/);
  assert.match(draft,/from public\.nexus_payments/);
  assert.match(draft,/billing_interval_months=1/);
  assert.match(draft,/p\.code='crm'/);
  assert.match(draft,/raise exception 'payment claim state changed concurrently'/);
  assert.doesNotMatch(draft,/\b(update|insert into|delete from)\s+public\.organization_product_access/i);
  assert.doesNotMatch(draft,/\b(update|insert into|delete from)\s+public\.nexus_payments/i);
  assert.doesNotMatch(draft,/\bupdate\s+auth\.users/i);
});
