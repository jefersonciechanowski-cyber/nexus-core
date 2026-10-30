#!/usr/bin/env node
// Static release evidence ONLY. It cannot inspect Supabase secrets, Asaas
// production billing or a live end-to-end payment. Never infer "launch-ready"
// solely from CI passing or from a sandbox test.
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';

const here=dirname(fileURLToPath(import.meta.url));
export function assessCrmCommercialLaunch(root=resolve(here,'..')) {
  const source=path=>readFileSync(resolve(root,path),'utf8');
  const asaasCheckout=source('supabase/functions/nexus-public-crm-monthly-asaas/index.ts');
  const provision=source('supabase/functions/nexus-crm-asaas-provision/index.ts');
  const verifier=source('supabase/functions/nexus-crm-asaas-verify-event/index.ts');
  const trial=source('supabase/functions/nexus-admin-crm-trial/index.ts');
  const expiry=source('supabase/functions/nexus-crm-trial-reconcile/index.ts');
  const trialSchedule=source('.github/workflows/crm-trial-expiry.yml');
  const grantGate=source('supabase/functions/_shared/crm-trial-release-gates.mjs');

  const evidence={
    sandboxHostedCheckout:asaasCheckout.includes("fetch('https://api-sandbox.asaas.com/v3/paymentLinks'"),
    realCheckoutBlocked:asaasCheckout.includes("input.companyName !== 'Nexus CRM Sandbox E2E'")
      && asaasCheckout.includes("NEXUS_CRM_ASAAS_MONTHLY_MODE') !== 'sandbox'"),
    realPaymentReconciliationBlocked:verifier.includes("environment:'sandbox'")
      && verifier.includes('claimEnabled:false'),
    automaticProvisioningHardOff:provision.includes('STAGED_ASAAS_DISABLED = true'),
    trialPilotExplicitlyGated:trial.includes("canOperateCrmTrial(Deno.env.toObject(), 'grant')")
      && grantGate.includes('NEXUS_CRM_TRIAL_RELEASE_APPROVED')
      && grantGate.includes('NEXUS_CRM_TRIAL_EXPIRY_SCHEDULE_CONFIRMED'),
    expirationWorkerExplicitlyGated:expiry.includes("canOperateCrmTrial(Deno.env.toObject(), 'expire')"),
    expiryScheduleOptIn:trialSchedule.includes("NEXUS_CRM_TRIAL_EXPIRY_WORKFLOW_ENABLED == 'true'")
      && trialSchedule.includes('audience=nexus-crm-trial-reconcile'),
  };
  const blockers=[];
  if(evidence.realCheckoutBlocked)blockers.push('live_monthly_checkout_not_implemented');
  if(evidence.realPaymentReconciliationBlocked)blockers.push('live_payment_verification_and_claim_not_homologated');
  if(evidence.automaticProvisioningHardOff)blockers.push('post_payment_crm_provisioning_disabled');
  if(evidence.trialPilotExplicitlyGated)blockers.push('free_trial_pilot_not_activated');
  if(evidence.expirationWorkerExplicitlyGated || evidence.expiryScheduleOptIn)blockers.push('trial_expiration_not_e2e_approved');
  // A free trial belongs to an existing organization: anonymous checkout
  // deliberately denies its identity. The upgrade must be a separate
  // authenticated, idempotent same-tenant conversion flow.
  blockers.push('trial_to_paid_same_tenant_conversion_needs_e2e_proof');
  blockers.push('real_payment_and_access_delivery_needs_external_acceptance');
  const safetyRegression=Object.entries(evidence).filter(([,ok])=>!ok).map(([key])=>key);
  return Object.freeze({
    product:'nexus-crm',scope:'source_only_not_deployment',
    readyForCommercialSales:false,
    safeForProductionLaunch:false,
    evidence,blockers,safetyRegression,
    requiresApproval:[
      'asaas_production_credentials_account_and_webhook',
      'real_legal_business_identity_and_provider_payment_e2e',
      'successful_paid_to_tenant_delivery_and_idempotent_retry',
      'trial_expiry_and_trial_to_paid_same_tenant_conversion',
      'separate_merge_deploy_and_live_billing_permission',
    ],
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=assessCrmCommercialLaunch();
  console.log(JSON.stringify(report,null,2));
  if(report.safetyRegression.length || process.argv.includes('--require-live-ready'))process.exitCode=1;
}
