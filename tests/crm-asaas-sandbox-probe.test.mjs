import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-sandbox-probe/index.ts',import.meta.url),'utf8');
test('Asaas key diagnostic was permanently retired after successful validation',()=>{
  assert.match(source,/status: 'retired'/);
  assert.match(source,/billing: 'disabled'/);
  assert.match(source,/status: 410/);
  assert.doesNotMatch(source,/ASAAS_SANDBOX_API_KEY|access_token|fetch\(|createClient\(|api-sandbox|checkout|stripe|paymentLinks/);
});
