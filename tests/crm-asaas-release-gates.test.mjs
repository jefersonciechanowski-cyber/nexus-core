import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
for (const slug of ["nexus-public-crm-monthly-asaas","nexus-crm-asaas-monthly-events","nexus-crm-asaas-verify-event","nexus-crm-asaas-provision"]) {
  test(slug+' must fail closed before payment or database access',()=>{
    const src=readFileSync(new URL('../supabase/functions/'+slug+'/index.ts',import.meta.url),'utf8');
    const guard=src.indexOf('if (STAGED_ASAAS_DISABLED)');
    assert.ok(guard>0,slug);
    for(const call of ['await fetch(', 'admin.from(', 'admin.rpc(', 'await provisionSaleForProvider(']){
      const idx=src.indexOf(call); if(idx>=0)assert.ok(guard<idx,slug+' '+call);
    }
    assert.match(src,/STAGED_ASAAS_DISABLED = true/);
  });
}
