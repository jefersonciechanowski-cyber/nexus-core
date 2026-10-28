import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {trustedAsaasToken,sanitizeCrmAsaasEvent} from '../supabase/functions/_shared/crm-asaas-events.mjs';
const src=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-sandbox-inbox/index.ts',import.meta.url),'utf8');
const tok='test-sandbox-unique-webhook-token-0123456789';
test('receiver requires specific sandbox opt-in and dedicated authenticated token',()=>{
 assert.match(src,/NEXUS_CRM_ASAAS_SANDBOX_INBOX_ENABLED/);
 assert.match(src,/NEXUS_CRM_ASAAS_EVENTS_TEST_TOKEN/);
 assert.match(src,/expectedToken.length < 32/);
 assert.match(src,/expectedToken === \(Deno.env.get\('ASAAS_SANDBOX_API_KEY'\)/);
 assert.match(src,/trustedAsaasToken\(request.headers.get\('asaas-access-token'\), expectedToken\)/);
 assert.match(src,/request.method !== 'POST'/);
 assert.equal(trustedAsaasToken(tok,tok),true);
 assert.equal(trustedAsaasToken('bad',tok),false);
});
test('receiver only inserts minimal event inbox rows; never touches access or sales',()=>{
 assert.match(src,/nexus_payment_webhook_events/);
 assert.match(src,/\.insert\(event\)/);
 assert.match(src,/duplicate: error\?\.code === '23505'/);
 assert.doesNotMatch(src,/nexus_sales|organization_product_access|provisionCrmTenant|\.update\(|paymentLinks|api-sandbox\.asaas\.com|fetch\(/);
 const ev=sanitizeCrmAsaasEvent({id:'evt_05b708f961d739ea7eba7e4db318f621',event:'PAYMENT_RECEIVED',payment:{id:'pay_080225913252',status:'RECEIVED',billingType:'PIX',value:5,customerEmail:'private@example.invalid'}});
 assert.equal(ev.event_type,'PAYMENT_RECEIVED');
 assert.doesNotMatch(JSON.stringify(ev),/private@example/);
});
