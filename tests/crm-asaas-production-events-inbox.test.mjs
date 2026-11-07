import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {sanitizeCrmAsaasEvent} from '../supabase/functions/_shared/crm-asaas-events.mjs';

const src=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-production-events/index.ts',import.meta.url),'utf8');
const sql=readFileSync(new URL('../docs/CRM_ASAAS_PRODUCTION_EVENTS_SQL_DRAFT_20261107.sql',import.meta.url),'utf8');
const sandbox=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-monthly-events/index.ts',import.meta.url),'utf8');

test('production inbox is OFF by default; receive-only needs two independent opt-in flags',()=>{
 const on=src.indexOf('const RECEIVE_ONLY_MODE = true');
 const gate=src.indexOf("Deno.env.get('NEXUS_CRM_ASAAS_PROD_EVENTS_RECEIVE_ONLY_ENABLED')");
 const db=src.indexOf("admin.from('nexus_crm_asaas_production_events')");
 assert.ok(on>=0&&gate>on&&db>gate);
 assert.match(src,/NEXUS_CRM_ASAAS_PROD_EVENTS_ENABLED/);
 assert.match(src,/NEXUS_CRM_ASAAS_PROD_EVENTS_RECEIVE_ONLY_ENABLED/);
 assert.match(src,/!== 'true'/);
 assert.doesNotMatch(src,/STAGED_PRODUCTION_EVENTS_DISABLED|NEXUS_CRM_ASAAS_PROD_EVENTS_HOMOLOGATED/);
 assert.doesNotMatch(src,/NEXUS_CRM_ASAAS_SANDBOX_E2E_ENABLED|api-sandbox\.asaas\.com/);
 // It may compare against the Sandbox key to reject token REUSE, but may not
 // perform Sandbox requests or select the Sandbox financial environment.
 assert.match(src,/'ASAAS_SANDBOX_API_KEY'/);
 assert.doesNotMatch(src,/https:\/\/api\.asaas\.com|https:\/\/api-sandbox\.asaas\.com|fetch\(/);
});

test('events require a dedicated token, bounded JSON and sanitization before persistence',()=>{
 const auth=src.indexOf('trustedAsaasToken(');
 const parse=src.indexOf('JSON.parse(raw)');
 const sanitize=src.indexOf('sanitizeCrmAsaasEvent(incoming)');
 const db=src.indexOf("admin.from('nexus_crm_asaas_production_events')");
 assert.ok(auth>=0 && auth < parse && parse < sanitize && sanitize < db);
 assert.match(src,/ASAAS_PRODUCTION_API_KEY/);
 assert.match(src,/ASAAS_SANDBOX_API_KEY/);
 assert.match(src,/NEXUS_CRM_ASAAS_PROD_WORKER_SECRET/);
 assert.match(src,/secret\.length < 32 \|\| secret\.length > 255/);
 assert.match(src,/trustedAsaasToken\(request\.headers\.get\('asaas-access-token'\),secret\)/);
 assert.match(src,/MAX_BODY_BYTES = 32768/);
 assert.match(src,/request\.headers\.get\('asaas-access-token'\)/);
 assert.match(src,/NEXUS_CRM_ASAAS_PROD_EVENTS_TOKEN/);
 assert.match(src,/error\.code!=='23505'/);
 assert.match(src,/respond\(\{received:true,duplicate:error\?\.code==='23505'\},200\)/);
 assert.doesNotMatch(src,/console\.(log|warn|error)|response\.text\(\)/);
});

test('separate production-only table has RLS, unique event IDs, no anonymous privileges',()=>{
 assert.match(sql,/nexus_crm_asaas_production_events/);
 assert.match(sql,/provider_event_id text primary key/);
 assert.match(sql,/check \(environment = 'production'\)/);
 assert.match(sql,/enable row level security/);
 assert.match(sql,/revoke all on public\.nexus_crm_asaas_production_events/);
 assert.match(sql,/from public, anon, authenticated/);
 assert.match(sql,/grant select, insert .*to service_role/);
 assert.doesNotMatch(sql,/organization_product_access|nexus_payments|update public\.nexus_sales/);
});

test('real events are reduced to identifiers and amounts before storage; Sandbox remains separately blocked',()=>{
 const sanitized=sanitizeCrmAsaasEvent({
  id:'evt_abc1234567',event:'PAYMENT_RECEIVED',dateCreated:'2026-11-07',
  payment:{id:'pay_abc123456',paymentLink:'plink_abc456',subscription:'sub_abc123456',
   status:'RECEIVED',billingType:'PIX',value:79,cpfCnpj:'12345678909',email:'not-to-be-saved@example.test'},
 });
 assert.equal(sanitized.provider_event_id,'asaas:evt_abc1234567');
 assert.equal(sanitized.payload.resource.value,79);
 assert.ok(!JSON.stringify(sanitized).includes('not-to-be-saved'));
 assert.ok(!JSON.stringify(sanitized).includes('12345678909'));
 assert.match(sandbox,/STAGED_ASAAS_DISABLED = true/);
 assert.match(sandbox,/NEXUS_CRM_ASAAS_MONTHLY_MODE'\) !== 'sandbox'/);
 assert.doesNotMatch(sandbox,/nexus_crm_asaas_production_events/);
});

test('no emails, CRM provisioning, charging or access mutations are reachable in the inbox',()=>{
 assert.doesNotMatch(src,/sendCrmAccessEmail|provisionSaleForProvider|provisionCrmTenant|syncCrmEntitlement/);
 assert.doesNotMatch(src,/\/v3\/payments|\/v3\/subscriptions|\/v3\/paymentLinks|checkout\.sessions/);
 assert.doesNotMatch(src,/admin\.rpc\(|\.from\('organization_product_access'\)|\.from\('nexus_payments'\)|\.update\(/);
 assert.match(src,/await admin\.from\('nexus_crm_asaas_production_events'\)\.insert/);
 assert.match(src,/\bRECEIVE_ONLY_MODE = true/);
 assert.doesNotMatch(src,/fetch\(/);
});
