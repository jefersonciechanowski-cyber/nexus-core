import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {canOperateCrmTrial} from '../supabase/functions/_shared/crm-trial-release-gates.mjs';

const fullyStaged={
  NEXUS_CRM_TRIAL_RELEASE_APPROVED:'true',
  NEXUS_CRM_TRIAL_RELEASE_MODE:'pilot',
  NEXUS_CRM_TRIAL_EXPIRY_SCHEDULE_CONFIRMED:'true',
  NEXUS_CRM_TRIAL_RECONCILE_ENABLED:'true',
  NEXUS_CRM_TRIAL_GRANTS_ENABLED:'true',
};

test('default-off; grant and expiry require separately approved pilot and expiration',()=>{
  for(const operation of ['grant','expire']){
    assert.equal(canOperateCrmTrial({},operation),false);
    assert.equal(canOperateCrmTrial(null,operation),false);
    assert.equal(canOperateCrmTrial(fullyStaged,operation),true);
    for(const key of Object.keys(fullyStaged)){
      if(operation==='expire'&&key==='NEXUS_CRM_TRIAL_GRANTS_ENABLED')continue;
      const invalid={...fullyStaged,[key]:key==='NEXUS_CRM_TRIAL_RELEASE_MODE'?'production':'false'};
      assert.equal(canOperateCrmTrial(invalid,operation),false,key+' '+operation);
    }
    assert.equal(canOperateCrmTrial({...fullyStaged,NEXUS_CRM_TRIAL_RELEASE_APPROVED:'TRUE'},operation),false);
  }
  assert.equal(canOperateCrmTrial(fullyStaged,'unknown'),false);
});

test('trial admin and worker deny before any DB access or tenant mutation',()=>{
  for(const [slug,operation] of [['nexus-admin-crm-trial','grant'],['nexus-crm-trial-reconcile','expire']]){
    const src=readFileSync(new URL('../supabase/functions/'+slug+'/index.ts',import.meta.url),'utf8');
    const gate=src.indexOf("if (!canOperateCrmTrial(Deno.env.toObject(), '"+operation+"'))");
    assert.ok(gate>0,'missing stage flag gate '+slug);
    for(const op of ['createClient(', "admin.rpc(","admin.from(","provisionCrmTenant("]){
      const index=src.indexOf(op);if(index>=0)assert.ok(gate<index,slug+' '+op);
    }
    assert.match(src,/NEXUS_CRM_TRIAL_RECONCILE_ENABLED/);
  }
});

test('expiry workflow is scheduled daily but skipped until explicitly opted in',()=>{
  const src=readFileSync(new URL('../.github/workflows/crm-trial-expiry.yml',import.meta.url),'utf8');
  assert.match(src,/schedule:/);
  assert.match(src,/NEXUS_CRM_TRIAL_EXPIRY_WORKFLOW_ENABLED == 'true'/);
  assert.match(src,/audience=nexus-crm-trial-reconcile/);
  assert.match(src,/nexus-crm-trial-reconcile/);
  assert.match(src,/id-token: write/);
  assert.match(src,/pending_review/);
  assert.doesNotMatch(src,/secrets\.|ASAAS_SANDBOX_API_KEY|STRIPE_SECRET/);
});
