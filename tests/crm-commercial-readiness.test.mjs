import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assessCrmCommercialLaunch} from '../scripts/crm-commercial-readiness.mjs';

test('readiness never confuses passing Sandbox CI with production sales',()=>{
  const report=assessCrmCommercialLaunch();
  assert.equal(report.scope,'source_only_not_deployment');
  assert.equal(report.readyForCommercialSales,false);
  assert.equal(report.safeForProductionLaunch,false);
  assert.deepEqual(report.safetyRegression,[]);
  assert.equal(report.evidence.sandboxHostedCheckout,true);
  assert.equal(report.evidence.realCheckoutBlocked,true);
  assert.equal(report.evidence.realPaymentReconciliationBlocked,true);
  assert.equal(report.evidence.automaticProvisioningHardOff,true);
  assert.equal(report.evidence.trialPilotExplicitlyGated,true);
  assert.equal(report.evidence.expirationWorkerExplicitlyGated,true);
  assert.equal(report.evidence.expiryScheduleOptIn,true);
});

test('all launch blockers remain visible; no payment, Asaas or Supabase network calls',()=>{
  const report=assessCrmCommercialLaunch();
  for(const code of [
    'live_monthly_checkout_not_implemented',
    'live_payment_verification_and_claim_not_homologated',
    'post_payment_crm_provisioning_disabled',
    'free_trial_pilot_not_activated',
    'trial_expiration_not_e2e_approved',
    'trial_to_paid_same_tenant_conversion_needs_e2e_proof',
    'real_payment_and_access_delivery_needs_external_acceptance',
  ])assert.ok(report.blockers.includes(code),code);
  const src=readFileSync(new URL('../scripts/crm-commercial-readiness.mjs',import.meta.url),'utf8');
  // Source inspection legitimately contains quoted fragments like "fetch('...".
  // Detect executable network/database calls, not string literals being inspected.
  assert.doesNotMatch(src,/\bawait\s+fetch\(|\bcreateClient\(|\b(?:admin|db)\.(?:insert|update|upsert|delete|rpc)\s*\(/);
  assert.match(src,/readyForCommercialSales:false/);
  assert.match(src,/safeForProductionLaunch:false/);
});

test('release checklist remains separated from deployment and protects courtesy grants',()=>{
  const checkout=readFileSync(new URL('../supabase/functions/nexus-public-crm-monthly-asaas/index.ts',import.meta.url),'utf8');
  assert.match(checkout,/preflight_nexus_crm_public_identity/);
  assert.match(checkout,/Empresa já cadastrada: solicite vinculação antes de contratar/);
  const trial=readFileSync(new URL('../supabase/functions/nexus-admin-crm-trial/index.ts',import.meta.url),'utf8');
  assert.match(trial,/commercial_condition: 'standard'/);
  assert.match(trial,/if \(existingAccess\?\.id\)/);
  assert.doesNotMatch(trial,/commercial_condition: 'courtesy'/);
});
