import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeTrialRequest,addTrialDays,fingerprintTrialIdentity } from '../supabase/functions/_shared/crm-trial-contract.mjs';

const sample={companyName:'Empresa do Cliente',responsibleName:'Responsável',email:'pessoa@empresa.example',
  registrationNumber:'12.345.678/0001-95',trialDays:15,planId:'a1a2a3a4-b5b6-4c7c-8d8e-901234567890'};
const endpoint=readFileSync(new URL('../supabase/functions/nexus-admin-crm-trial/index.ts',import.meta.url),'utf8');
const worker=readFileSync(new URL('../supabase/functions/nexus-crm-trial-reconcile/index.ts',import.meta.url),'utf8');
const courtesy=readFileSync(new URL('../supabase/functions/nexus-admin-crm-courtesy/index.ts',import.meta.url),'utf8');
const page=readFileSync(new URL('../apps/nexus-admin/crm-access.html',import.meta.url),'utf8');
const sql=readFileSync(new URL('../docs/CRM_TRIAL_CLAIM_SQL_DRAFT.sql',import.meta.url),'utf8');

test('15 days and 30 days supported; rejects periods beyond, annual plan and malformed IDs',()=>{
  assert.equal(normalizeTrialRequest(sample).payload.trialDays,15);
  assert.equal(normalizeTrialRequest({...sample,trialDays:30}).payload.trialDays,30);
  for(const trialDays of [0,1,14,16,29,31,365])assert.ok(normalizeTrialRequest({...sample,trialDays}).error);
  assert.ok(normalizeTrialRequest({...sample,planId:'forged'}).error);
  assert.ok(normalizeTrialRequest({...sample,registrationNumber:'not-a-document'}).error);
  assert.equal(normalizeTrialRequest({...sample,provider:'stripe',chargeAmount:1}).payload.chargeAmount,undefined);
});

test('date calculation honors leap days and month/year crossing in UTC',()=>{
  assert.equal(addTrialDays('2026-10-26',15),'2026-11-10');
  assert.equal(addTrialDays('2026-10-26',30),'2026-11-25');
  assert.equal(addTrialDays('2028-02-15',15),'2028-03-01');
  assert.equal(addTrialDays('2026-12-20',30),'2027-01-19');
  assert.throws(()=>addTrialDays('2026-02-31',15));
  assert.throws(()=>addTrialDays('2026-01-01',12));
});

test('fingerprint determinism and scoped secrecy protect email/document from plain hashing',async()=>{
  const secret='not-a-real-secret-xxxxxxxxxxxxxxxxxxx';
  const email=await fingerprintTrialIdentity(secret,'email','pessoa@empresa.example');
  const doc=await fingerprintTrialIdentity(secret,'document','12345678000195');
  assert.match(email,/^[0-9a-f]{64}$/);
  assert.notEqual(email,doc);
  assert.equal(email,await fingerprintTrialIdentity(secret,'email','pessoa@empresa.example'));
  assert.notEqual(email,await fingerprintTrialIdentity('different-not-a-real-secret-xxxxxxxx','email','pessoa@empresa.example'));
  await assert.rejects(fingerprintTrialIdentity('weak','email','e'));
});

test('admin-only MFA2, default-off and CRM-only trial cannot overwrite courtesy or existing account',()=>{
  for(const pattern of [/NEXUS_CRM_TRIAL_GRANTS_ENABLED/,/getAuthenticatorAssuranceLevel/,/currentLevel !== 'aal2'/,
    /profile\.role !== 'nexus_admin'/,/reserve_nexus_crm_trial/,/confirm_nexus_crm_trial/,
    /registeredOrg\?\.id/,/emailOrganizations \?\? \[\]\)\.length > 0/,
    /if \(existingAccess\?\.id\)/,/TRIAL_ALLOWED_PLANS\.includes\(plan\.code\)/,
    /subscription_status: 'trial'/,/commercial_condition: 'standard'/,/billing_provider: null/,
    /contracted_price_cents: 0/,/trialEndsAt = addTrialDays/,/provisionCrmTenant/]){
    assert.match(endpoint,pattern);
  }
  assert.ok(endpoint.indexOf("reserve_nexus_crm_trial") < endpoint.indexOf(".from('organizations')\n      .insert"));
  assert.doesNotMatch(endpoint,/stripe\.checkout|asaas\.com|payment_method_types/);
  assert.match(endpoint,/retryable: false/);
  assert.ok(!endpoint.includes("commercial_condition: 'courtesy'"));
  assert.match(courtesy,/durationMonths < 1 \|\| durationMonths > 24/);
  assert.match(courtesy,/commercial_condition: 'courtesy'/);
  assert.match(courtesy,/subscription_status: 'active'/);
});

test('trial ledger is unique, service-role only, with confirm gate',()=>{
  assert.match(sql,/email_fingerprint text not null unique/);
  assert.match(sql,/document_fingerprint text not null unique/);
  assert.match(sql,/trial_days integer not null check \(trial_days in \(15,30\)\)/);
  assert.match(sql,/on conflict do nothing/);
  assert.match(sql,/enable row level security/);
  assert.match(sql,/revoke all on public\.nexus_crm_trial_claims from PUBLIC,anon,authenticated/);
  assert.match(sql,/grant execute on function public\.reserve_nexus_crm_trial/);
  assert.match(sql,/grant execute on function public\.confirm_nexus_crm_trial/);
  assert.match(sql,/a\.subscription_status='trial'/);
  assert.match(sql,/a\.commercial_condition='standard'/);
});

test('trial admin and expiry worker are disabled before provisioning or suspension',()=>{
  assert.match(endpoint,/STAGED_TRIAL_DISABLED = true/);
  assert.match(worker,/STAGED_TRIAL_DISABLED = true/);
  assert.ok(endpoint.indexOf('if (STAGED_TRIAL_DISABLED)') < endpoint.indexOf('provisionCrmTenant(admin'));
  assert.ok(worker.indexOf('if (STAGED_TRIAL_DISABLED)') < worker.indexOf("admin.rpc('expire_nexus_crm_trial_access'"));
});
