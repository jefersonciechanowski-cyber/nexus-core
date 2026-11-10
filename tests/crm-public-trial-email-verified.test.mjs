import { test } from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import { normalizeCrmPublicTrial, hashCrmTrialToken, publicTrialAllowed }
  from '../supabase/functions/_shared/crm-public-trial-contract.mjs';

import { canOperateCrmTrial } from '../supabase/functions/_shared/crm-trial-release-gates.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const request=read('supabase/functions/nexus-public-crm-trial-request/index.ts');
const activate=read('supabase/functions/nexus-public-crm-trial-activate/index.ts');
const sql=read('supabase/migrations/20261108234500_crm_public_trial_email_verification.sql');
const schedule=read('.github/workflows/crm-trial-expiry.yml');
const valid={
  companyName:'Empresa Teste',responsibleName:'Pessoa Teste',email:'test@example.com',
  phone:'41987654321',registrationNumber:'52998224725',postalCode:'80010000',
  street:'Rua Um',streetNumber:'123',district:'Centro',city:'Curitiba',state:'PR',
  planCode:'pro',acceptedTerms:true,trialDays:15,
};
test('public trial requires valid CPF, consent and precisely 15 days',()=>{
 assert.equal(normalizeCrmPublicTrial(valid).payload.trialDays,15);
 assert.ok(normalizeCrmPublicTrial({...valid,trialDays:30}).error);
 assert.ok(normalizeCrmPublicTrial({...valid,trialDays:0}).error);
 assert.ok(normalizeCrmPublicTrial({...valid,acceptedTerms:false}).error);
 assert.ok(normalizeCrmPublicTrial({...valid,registrationNumber:'11111111111'}).error);
 assert.ok(normalizeCrmPublicTrial({...valid,planCode:'another'}).error);
});
test('secret, email-only activation and expiry flags must all be approved',()=>{
 assert.equal(publicTrialAllowed({NEXUS_CRM_PUBLIC_TRIAL_READY:'true'}),false);
 assert.equal(publicTrialAllowed({
  NEXUS_CRM_PUBLIC_TRIAL_READY:'true',NEXUS_CRM_TRIAL_RELEASE_APPROVED:'true',
  NEXUS_CRM_TRIAL_RELEASE_MODE:'pilot',
  NEXUS_CRM_TRIAL_PAID_UPGRADE_READY:'true',
  NEXUS_CRM_TRIAL_RECONCILE_ENABLED:'true',
  NEXUS_CRM_TRIAL_EXPIRY_SCHEDULE_CONFIRMED:'true',
 }),true);
 assert.match(request,/fingerprintTrialIdentity/);
 assert.match(request,/sendCrmSmtpMail/);
 assert.match(request,/hashCrmTrialToken/);
 assert.match(request,/normalizeCrmPublicTrial/);
 assert.match(request,/state:'pending'/);
 assert.doesNotMatch(request,/provisionCrmTenant|reserve_nexus_crm_trial/);
 assert.match(activate,/claim_nexus_crm_public_trial_request/);
 assert.match(activate,/reserve_nexus_crm_trial/);
 assert.match(activate,/provisionCrmTenant/);
 assert.match(activate,/confirm_nexus_crm_trial/);
 assert.match(activate,/sendCrmSmtpMail/);
 assert.doesNotMatch(activate,/paymentLinks|checkout\.sessions|\/v3\/payments/);
});
test('email-token hashing is one-way and has no raw token stored in DB',async()=>{
 const token='a'.repeat(64);
 const hash=await hashCrmTrialToken(token);
 assert.match(hash,/^[0-9a-f]{64}$/);
 assert.notEqual(hash,token);
 await assert.rejects(()=>hashCrmTrialToken('bad'));
 assert.match(sql,/token_hash text NOT NULL UNIQUE/);
 assert.doesNotMatch(sql,/token_plaintext|raw_token/);
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/REVOKE ALL ON public\.nexus_crm_public_trial_requests/);
 assert.match(sql,/WHERE token_hash=p_token_hash AND state='pending' AND expires_at>pg_catalog\.now\(\)/);
 assert.match(sql,/TO service_role/);
});
test('first access verification requires user confirmation and keeps data private',()=>{
 assert.match(request,/site-captacao\/trial\/confirm#token=/);
 assert.match(activate,/link\.origin!==ORIGIN/);
 assert.match(activate,/link\.pathname!=='\/auth\/primeiro-acesso'/);
 assert.match(activate,/if\(!sent\.sent\)/);
 assert.match(activate,/trial_ends_at:end/);
 assert.match(activate,/subscription_status:'trial'/);
 assert.match(activate,/billing_provider:null/);
 assert.match(schedule,/cron: '23 9 \* \* \*'/);
 assert.match(schedule,/NEXUS_CRM_TRIAL_EXPIRY_WORKFLOW_ENABLED/);
});

test('trial request keeps UF separate from the lifecycle status column',()=>{
 assert.match(sql,/city text,address_state text/);
 assert.equal((sql.match(/\bstate text NOT NULL DEFAULT 'pending'/g)||[]).length,1);
 assert.match(request,/city:input\.city,address_state:input\.state/);
 assert.match(activate,/city:trial\.city,state:trial\.address_state/);
 assert.doesNotMatch(request,/city:input\.city,state:input\.state/);
});

test('public activation never opens while the scheduled expiry gate rejects configuration',()=>{
 const keys=['NEXUS_CRM_PUBLIC_TRIAL_READY','NEXUS_CRM_TRIAL_RELEASE_APPROVED',
  'NEXUS_CRM_TRIAL_RECONCILE_ENABLED','NEXUS_CRM_TRIAL_EXPIRY_SCHEDULE_CONFIRMED','NEXUS_CRM_TRIAL_PAID_UPGRADE_READY'];
 for(const mode of [undefined,'','production','pilot']){
  for(let mask=0;mask<32;mask++){
   const env=Object.fromEntries(keys.map((key,i)=>[key,mask&(1<<i)?'true':'false']));
   env.NEXUS_CRM_TRIAL_RELEASE_MODE=mode;
   assert.equal(publicTrialAllowed(env),mode==='pilot'&&mask===31);
   if(publicTrialAllowed(env))assert.equal(canOperateCrmTrial(env,'expire'),true);
  }
 }
});
