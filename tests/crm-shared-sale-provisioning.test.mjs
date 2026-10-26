import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const shared=readFileSync(new URL('../supabase/functions/_shared/nexus-sale-provisioning.ts',import.meta.url),'utf8');
const stripe=readFileSync(new URL('../supabase/functions/stripe-webhook/index.ts',import.meta.url),'utf8');
const crm=readFileSync(new URL('../supabase/functions/stripe-webhook/crm-provisioning.ts',import.meta.url),'utf8');
const draft=readFileSync(new URL('../docs/CRM_ASAAS_PAYMENT_CLAIM_SQL_DRAFT.sql',import.meta.url),'utf8');

test('existing Stripe passes provider explicitly to the same reusable, guarded provisioner',()=>{
  assert.match(stripe,/import \{ provisionSaleForProvider \} from '\.\.\/_shared\/nexus-sale-provisioning\.ts'/);
  assert.match(stripe,/return provisionSaleForProvider\(admin, saleInput, context, \{/);
  assert.match(stripe,/provider: 'stripe'/);
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

test('Asaas cannot call shared CRM provisioner merely after webhook or paid event',()=>{
  assert.match(shared,/saleInput\?\.provider !== 'asaas'/);
  assert.match(shared,/saleInput\?\.environment !== 'sandbox'/);
  assert.match(shared,/saleInput\?\.source !== 'site-captacao'/);
  assert.match(shared,/saleInput\?\.sale_status !== 'paid'/);
  assert.match(shared,/!saleInput\?\.paid_at/);
  assert.match(shared,/!context\.subscriptionId/);
  assert.match(shared,/from\('nexus_crm_asaas_verified_payments'\)/);
  assert.match(shared,/eq\('decision', 'provision_ready'\)/);
  assert.match(shared,/eq\('registration_number', saleInput\.registration_number\)/);
  assert.match(shared,/if \(linkedOrgError \|\| linkedOrg\?\.id\)/);
  assert.ok(shared.indexOf("eq('decision', 'provision_ready')") < shared.indexOf("auth.admin.createUser"));
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
