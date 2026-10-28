import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
for(const slug of ['nexus-admin-crm-trial','nexus-crm-trial-reconcile']){
 test(slug+' blocks grants/expiry before data access',()=>{
  const s=readFileSync(new URL('../supabase/functions/'+slug+'/index.ts',import.meta.url),'utf8');
  const guard=s.indexOf('if (STAGED_TRIAL_DISABLED)');assert.ok(guard>0);assert.match(s,/STAGED_TRIAL_DISABLED = true/);
  for(const op of ['createClient(', "admin.rpc(","admin.from(","provisionCrmTenant("]){const pos=s.indexOf(op); if(pos>=0)assert.ok(guard<pos,op);}
 });
}
