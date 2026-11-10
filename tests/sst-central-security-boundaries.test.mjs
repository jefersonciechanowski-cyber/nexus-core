import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');

const membership=read('supabase/migrations/20261110014000_sst_central_security_access_hardening.sql');
const privileged=read('supabase/migrations/20261110014500_sst_security_definer_entitlement_guards.sql');
const expiry=read('supabase/migrations/20261110015000_sst_brazil_expiry_and_suspension.sql');
const worker=read('supabase/functions/nexus-sst-asaas-reconcile/index.ts');
const oldCheckout=read('supabase/functions/nexus-public-sales/index.ts');
const pilot=read('supabase/functions/nexus-sst-asaas-upgrade/index.ts');
const financial=read('supabase/migrations/20261110015500_sst_central_financial_evidence_guard.sql');
const proof=read('supabase/functions/_shared/sst-asaas-payment-proof.mjs');

test('tenant context rejects revoked membership and inactive organization',()=>{
  assert.match(membership,/join public\.organization_memberships m/);
  assert.match(membership,/m\.user_id=p\.id and m\.organization_id=p\.organization_id and m\.active=true/);
  assert.match(membership,/o\.id=p\.organization_id and o\.status='active'/);
  assert.match(membership,/p\.id=\(select auth\.uid\(\)\) and p\.active=true/);
});

test('operational reads and writes require an active SST entitlement on each tenant table',()=>{
  assert.match(membership,/create policy %I on public\.%I as restrictive for all to authenticated/);
  assert.match(membership,/private\.sst_operational_access_allowed\(organization_id\)/);
  for(const table of ['employees','employee_documents','company_documents','epi_catalog',
    'epi_deliveries','epi_purchases','exam_records','exam_catalog','training_records',
    'control_matrix_rules','occurrences','regulatory_inspections','job_roles',
    'units','notification_delivery_logs','training_record_code_counters']){
    assert.ok(membership.includes("'"+table+"'"), 'Missing table '+table);
  }
  assert.match(membership,/a\.subscription_status='trial'/);
  assert.match(membership,/a\.renews_at is not null and a\.renews_at >= current_date/);
  assert.match(membership,/a\.access_status='active'/);
});

test('private SST storage downloads and writes are subject to the same entitlement',()=>{
  assert.match(membership,/on storage\.objects as restrictive for all to authenticated/);
  assert.match(membership,/bucket_id <> 'sst-documents'/);
  assert.match(membership,/storage\.foldername\(name\)/);
  assert.match(membership,/private\.sst_operational_access_allowed\(public\.current_org_id\(\)\)/);
});

test('SST access and plan changes require Nexus admin MFA',()=>{
  for(const action of ['insert','update','delete']){
    assert.match(membership,new RegExp('sst entitlement '+action+' requires nexus admin aal2'));
  }
  assert.match(membership,/public\.is_nexus_admin_aal2\(\)/);
  assert.match(membership,/as restrictive for update to authenticated/);
});

test('all privileged SST imports and business creation enforce commercial validity',()=>{
  for(const functionName of ['import_employees_bulk','import_epis_bulk',
    'import_exam_records_bulk','log_sst_document_generation',
    'create_managed_organization_core']){
    assert.ok(privileged.includes("'"+functionName+"'"));
  }
  assert.match(privileged,/not private\.sst_operational_access_allowed\(public\.current_org_id\(\)\)/);
});

test('expired trials are suspended on Brasília business day, never deleted',()=>{
  assert.match(expiry,/America\/Sao_Paulo/);
  assert.match(expiry,/a\.subscription_status='trial'/);
  assert.match(expiry,/plan\.code='piloto'/);
  assert.match(expiry,/a\.renews_at < v_local_date/);
  assert.match(expiry,/NEXUS_SST_TRIAL_EXPIRED/);
  assert.doesNotMatch(expiry,/delete\s+from\s+public\.organization_product_access/i);
  assert.match(worker,/admin\.rpc\('suspend_expired_nexus_sst_trials'\)/);
});

test('pilot payment cannot be diverted to old Stripe flow',()=>{
  assert.match(oldCheckout,/if \(body\.pilotUpgrade === true \|\| pilotContext\)/);
  assert.match(oldCheckout,/evitar cobrança duplicada/);
  assert.match(pilot,/https:\/\/api\.asaas\.com\/v3\/paymentLinks/);
  assert.match(pilot,/asaas\.com','www\.asaas\.com/);
  assert.match(pilot,/getContext\(admin,req\)/);
  assert.match(proof,/link\.externalReference!=='sst-pilot-'\+checkout\.id/);
  assert.match(proof,/customer\.cpfCnpj/);
  assert.match(proof,/customer\.email/);
});


test('Central forbids forging payment URLs, buyer identity or paid status',()=>{
  for(const field of [
    'provider_checkout_url','asaas_checkout_url','provider_subscription_id',
    'asaas_subscription_id','organization_id','user_id',
    'registration_number','email','plan_id','paid_at','provisioned_at'
  ]){
    assert.ok(financial.includes("'"+field+"'"), 'Financial identity guard missing '+field);
  }
  assert.match(financial,/guard_nexus_sales_financial_evidence/);
  assert.match(financial,/guard_sst_paid_entitlement_evidence/);
  assert.match(financial,/current_user not in \('authenticated','anon'\)/);
  assert.match(financial,/new\.subscription_status='active'/);
  assert.match(financial,/new\.access_status='active'/);
});
