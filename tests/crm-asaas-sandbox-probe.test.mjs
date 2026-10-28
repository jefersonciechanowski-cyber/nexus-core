import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const f=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-sandbox-probe/index.ts',import.meta.url),'utf8');
test('temporary Asaas credential verification is GET only and read only',()=>{
  assert.match(f,/request.method !== 'GET'/);
  assert.match(f,/Date.now\(\) >= EXPIRES_AT/);
  assert.match(f,/2026-10-28T20:00:00Z/);
  assert.match(f,/Date.now\(\) - lastChecked < CACHE_MS/);
  assert.match(f,/ASAAS_SANDBOX_API_KEY/);
  assert.match(f,/https:\/\/api-sandbox[.]asaas[.]com\/v3\/myAccount\/status\//);
  assert.match(f,/'User-Agent': 'NexusCRM-Sandbox-Probe\/1.0'/);
  assert.match(f,/'access_token': key/);
  assert.match(f,/method: 'GET'/);
  assert.doesNotMatch(f,/method:\s*'POST'|method:\s*'DELETE'|createClient|nexus_sales|paymentLinks|checkout\.sessions\.create|supabase-js/);
  assert.doesNotMatch(f,/JSON.stringify\(\{[^}]*key\b/);
});
