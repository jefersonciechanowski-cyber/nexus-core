import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const checkout=readFileSync(new URL('../supabase/functions/nexus-public-crm-monthly-asaas/index.ts',import.meta.url),'utf8');
test('Sandbox checkout has three hard requirements before database or provider calls',()=>{
  const guard=checkout.indexOf("if (Deno.env.get('NEXUS_CRM_ASAAS_SANDBOX_E2E_ENABLED')");
  const signature=checkout.indexOf('verifyCheckoutBridgeSignature(');
  const identity=checkout.indexOf("input.companyName !== 'Nexus CRM Sandbox E2E'");
  const firstDB=checkout.indexOf('createClient(supabaseUrl, serviceKey');
  const provider=checkout.indexOf("fetch('https://api-sandbox.asaas.com/v3/paymentLinks'");
  assert.ok(guard>=0&&guard<signature&&signature<identity&&identity<firstDB&&firstDB<provider);
  for(const flag of ['NEXUS_CRM_ASAAS_SANDBOX_E2E_ENABLED','NEXUS_CRM_ASAAS_MONTHLY_ENABLED','NEXUS_CRM_ASAAS_MONTHLY_MODE']){
    assert.ok(checkout.indexOf(flag)>=0);
  }
  assert.ok(checkout.includes('example[.]test'));
  assert.match(checkout, /hostname !== 'sandbox[.]asaas[.]com'/);
  assert.doesNotMatch(checkout,/https:\/\/api[.]asaas[.]com\/v3|fetch\('https:\/\/api[.]asaas[.]com/);
});
for (const slug of ['nexus-crm-asaas-monthly-events','nexus-crm-asaas-verify-event','nexus-crm-asaas-provision']) {
  test(slug+' remains permanently blocked before side effects',()=>{
    const src=readFileSync(new URL('../supabase/functions/'+slug+'/index.ts',import.meta.url),'utf8');
    const guard=src.indexOf('if (STAGED_ASAAS_DISABLED)');
    assert.ok(guard>0,slug);
    for(const call of ['await fetch(', 'admin.from(', 'admin.rpc(', 'await provisionSaleForProvider(']){
      const idx=src.indexOf(call); if(idx>=0)assert.ok(guard<idx,slug+' '+call);
    }
    assert.match(src,/STAGED_ASAAS_DISABLED = true/);
  });
}
