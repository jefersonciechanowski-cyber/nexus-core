import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const sql=readFileSync(new URL('../docs/CRM_ASAAS_SETTLEMENT_RESERVATION_SQL_DRAFT.sql',import.meta.url),'utf8');
const edge=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-verify-event/index.ts',import.meta.url),'utf8');
const verify=readFileSync(new URL('../supabase/functions/_shared/crm-asaas-provider-verification.mjs',import.meta.url),'utf8');

test('reservation schema cannot hold same payment or event twice',()=>{
  assert.match(sql,/provider_payment_id text primary key/);
  assert.match(sql,/provider_event_id text not null unique/);
  assert.match(sql,/sale_id uuid not null references public\.nexus_sales\(id\)/);
  assert.match(sql,/provider_subscription_id text not null/);
  assert.match(sql,/constraint crm_asaas_verified_subscription_id_format/);
  assert.match(sql,/on conflict do nothing/);
  assert.match(sql,/v_existing\.provider_event_id<>p_provider_event_id/);
  assert.match(sql,/provider_payment_conflict/);
});
test('SQL transaction serializes sale and provider subscription; prevents parallel subscriptions',()=>{
  assert.match(sql,/for update of s/);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/subscription_reserved_elsewhere/);
  assert.match(sql,/sale_has_another_subscription/);
  assert.match(sql,/s\.provider = 'asaas' and s\.environment = 'sandbox'/);
  assert.match(sql,/p\.code = 'crm'/);
  assert.match(sql,/v_sale\.billing_mode <> 'recurring' or v_sale\.billing_cycle_months <> 1/);
  assert.match(sql,/v_sale\.source <> 'site-captacao'/);
  assert.match(sql,/v_sale\.checkout_amount_cents is distinct from p_amount_cents/);
  assert.match(sql,/payment_not_linked/);
  assert.match(sql,/event_not_matching/);
  assert.match(sql,/\{resource,value\}/);
});
test('database function is private, default-deny, and never changes courtesy or CRM access',()=>{
  assert.match(sql,/enable row level security/);
  assert.match(sql,/revoke all on public\.nexus_crm_asaas_verified_payments from public, anon, authenticated/);
  assert.match(sql,/security definer set search_path = ''/);
  assert.match(sql,/revoke all on function public\.reserve_nexus_crm_asaas_verified_payment/);
  assert.match(sql,/to service_role/);
  assert.doesNotMatch(sql,/\bupdate\s+public\.(nexus_sales|organization_product_access|nexus_payments)/i);
  assert.doesNotMatch(sql,/\binsert\s+into\s+public\.(organization_product_access|nexus_payments|nexus_sales)/i);
  assert.doesNotMatch(sql,/\bdelete\s+from\s+public\.(organization_product_access|nexus_sales)/i);
});
test('internal sandbox-only verifier reserves ONLY after provider-read comparison',()=>{
  assert.match(edge,/reconcileCrmAsaasSettlement\(/);
  assert.match(edge,/reservationEnabled:false/);
  assert.match(edge,/claimEnabled:false/);
  assert.match(edge,/callRpc:async/);
  assert.match(edge,/NEXUS_CRM_ASAAS_VERIFY_ENABLED/);
  assert.match(edge,/NEXUS_CRM_ASAAS_MONTHLY_MODE/);
  assert.match(verify,/canActivateCrm: false/);
  assert.match(verify,/billingType: payment\.billingType/);
  assert.doesNotMatch(edge,/from\('organization_product_access'\)|from\('nexus_payments'\)|provisionCrmTenant|sendCrmAccessEmail/);
});
test('migration is a DRAFT, not an applied or automatic production migration',()=>{
  assert.match(sql,/REVIEW-ONLY SQL DRAFT/);
  assert.match(sql,/DO NOT APPLY TO PRODUCTION/);
  assert.match(sql,/reserve_nexus_crm_asaas_verified_payment/);
});
