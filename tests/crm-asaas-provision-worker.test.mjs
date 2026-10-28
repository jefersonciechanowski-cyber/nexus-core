import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const worker=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-provision/index.ts',import.meta.url),'utf8');
const lease=readFileSync(new URL('../docs/CRM_ASAAS_PROVISION_LEASE_SQL_DRAFT.sql',import.meta.url),'utf8');
const shared=readFileSync(new URL('../supabase/functions/_shared/nexus-sale-provisioning.ts',import.meta.url),'utf8');
const receipt=readFileSync(new URL('../supabase/functions/_shared/crm-asaas-payment-record.mjs',import.meta.url),'utf8');

test('worker is internal, OFF by default and restricted to sandbox mode',()=>{
  for(const flag of [
    'NEXUS_CRM_ASAAS_PROVISION_ENABLED','NEXUS_CRM_ASAAS_VERIFY_ENABLED',
    'NEXUS_CRM_ASAAS_RESERVATION_ENABLED','NEXUS_CRM_ASAAS_CLAIM_ENABLED',
    'NEXUS_CRM_ASAAS_MONTHLY_MODE','NEXUS_CRM_ASAAS_VERIFY_SECRET',
    'ASAAS_SANDBOX_API_KEY'
  ]) assert.ok(worker.includes(flag),flag);
  assert.match(worker,/trustedAsaasToken\(/);
  assert.match(worker,/api-sandbox\.asaas\.com\/v3/);
  assert.match(worker,/\.eq\('provider','asaas'\)\.eq\('environment','sandbox'\)/);
  assert.doesNotMatch(worker,/api\.asaas\.com\/v3|NEXUS_PAYMENT_LIVE_ENABLED|stripe\.checkout/);
});

test('worker must verify provider and financial claim BEFORE exclusive lease and CRM tenant',()=>{
  const points=[
    'verifyCrmAsaasPayment(', 'reconcileCrmAsaasSettlement(',
    "'begin_nexus_crm_asaas_provisioning'",
    'provisionSaleForProvider(', "'complete_nexus_crm_asaas_provisioning'",
  ].map(v=>worker.indexOf(v));
  assert.ok(points.every(x=>x>=0),JSON.stringify(points));
  for(let i=1;i<points.length;i++)assert.ok(points[i]>points[i-1],'order '+i);
  assert.match(worker,/verified\.subscriptionStatus!=='ACTIVE'/);
  assert.match(worker,/verified\.paymentStatus!=='RECEIVED'/);
  assert.match(worker,/verified\.paymentStatus!=='CONFIRMED'/);
  assert.match(worker,/lease\?\.decision!=='acquired'/);
  assert.match(worker,/sale_changed_after_claim/);
  assert.match(worker,/partial_provisioning_requires_manual_review/);
  assert.doesNotMatch(worker,/\.delete\(|auth\.admin\.deleteUser/);
});

test('financial receipt is inserted before CRM first-access e-mail',()=>{
  const i=shared.indexOf('recordVerifiedCrmAsaasPayment(');
  const j=shared.indexOf('await provisionCrmTenant(');
  const k=shared.indexOf('await sendCrmAccessEmail(');
  assert.ok(i>=0&&j>i&&k>j);
  assert.match(shared,/if \(provider === 'asaas'\) \{/);
  assert.match(receipt,/claim\.decision!=='provisioning'/);
  assert.match(receipt,/provider_payment_id:payment\.paymentId/);
  assert.match(receipt,/provider_subscription_id:payment\.subscriptionId/);
  assert.match(receipt,/organization_id:sale\.organization_id/);
  assert.match(receipt,/access_id:access\.id/);
});

test('lease is one-shot, service-role only, and completion requires finance + tenant',()=>{
  assert.match(lease,/for update/);
  assert.match(lease,/v_claim\.decision<>'provision_ready'/);
  assert.match(lease,/decision='provisioning'/);
  assert.match(lease,/v_claim\.decision<>'provisioning'/);
  assert.match(lease,/financial_receipt_missing/);
  assert.match(lease,/tenant_not_provisioned/);
  assert.match(lease,/decision='provisioned'/);
  assert.match(lease,/revoke all on function public\.begin_nexus_crm_asaas_provisioning/);
  assert.match(lease,/revoke all on function public\.complete_nexus_crm_asaas_provisioning/);
  assert.doesNotMatch(lease,/\bupdate\s+public\.organization_product_access/i);
  assert.doesNotMatch(lease,/\bdelete\s+from\s+public\.(nexus_sales|organizations|nexus_payments)/i);
});
