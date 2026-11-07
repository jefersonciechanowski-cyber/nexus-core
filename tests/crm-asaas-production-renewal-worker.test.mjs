import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('../supabase/functions/nexus-crm-asaas-production-renewal/index.ts',import.meta.url),'utf8');
const sync=readFileSync(new URL('../supabase/functions/stripe-webhook/crm-provisioning.ts',import.meta.url),'utf8');
const sql=readFileSync(new URL('../supabase/migrations/20261107233000_crm_asaas_production_renewal.sql',import.meta.url),'utf8');

test('live recurring worker is hard-off before input, DB, Asaas and CRM calls',()=>{
 const gate=src.indexOf('if(STAGED_ASAAS_PRODUCTION_RENEWAL_DISABLED)');
 const db=src.indexOf("admin.from('nexus_crm_asaas_production_events')");
 const provider=src.indexOf("fetch('https://api.asaas.com/v3'+path");
 const crm=src.indexOf('syncCrmEntitlement(');
 assert.ok(gate>=0&&db>gate&&provider>db&&crm>provider);
 assert.match(src,/STAGED_ASAAS_PRODUCTION_RENEWAL_DISABLED = true/);
 assert.match(src,/NEXUS_CRM_ASAAS_PROD_RENEWAL_ENABLED/);
 assert.match(src,/NEXUS_CRM_ASAAS_PROD_SETTLEMENT_READY/);
 assert.match(src,/NEXUS_CRM_ASAAS_PROD_WEBHOOK_CONFIRMED/);
 assert.match(src,/NEXUS_CRM_ASAAS_PROD_RENEWAL_SECRET/);
 assert.match(src,/trustedAsaasToken\(/);
 assert.doesNotMatch(src,/api-sandbox|ASAAS_SANDBOX_API_KEY/);
});

test('renewer uses four GET checks and only the service-role renewal SQL RPC',()=>{
 assert.match(src,/previewProductionCrmAsaasRenewal\(\{/);
 assert.match(src,/verified\.decision!=='verified_renewal_for_review'/);
 assert.match(src,/\.eq\('organization_id',sale\.organization_id\)\.eq\('product_id',sale\.product_id\)/);
 assert.match(src,/\.eq\('provider_subscription_id',subscriptionId\)/);
 assert.match(src,/fetch\('https:\/\/api\.asaas\.com\/v3'\+path/);
 assert.match(src,/method:'GET'/);
 assert.match(src,/record_nexus_crm_asaas_production_renewal/);
 assert.match(src,/syncCrmEntitlement\(/);
 assert.match(src,/recorded\.decision==='renewal_recorded'/);
 assert.match(src,/processing_status:'processed'/);
 assert.doesNotMatch(src,/provisionCrmTenant\(|sendCrmAccessEmail\(|auth\.admin\.createUser\(/);
 assert.doesNotMatch(src,/\/v3\/payments',\s*\{method:'POST'|\/v3\/subscriptions',\s*\{method:'POST'/);
 assert.match(sync,/ensure_crm_sync_delivery/);
 assert.match(sync,/confirm_crm_sync_delivery/);
});

test('SQL function is service-role-only, compares exact invoice and locks access',()=>{
 assert.match(sql,/create or replace function public\.record_nexus_crm_asaas_production_renewal/);
 assert.match(sql,/language plpgsql security definer set search_path=''/);
 assert.match(sql,/where id=p_access_id for update/);
 assert.match(sql,/environment='production'/);
 assert.match(sql,/v_access\.commercial_condition is distinct from 'standard'/);
 assert.match(sql,/v_access\.subscription_status='cancelled'/);
 assert.match(sql,/p_due_date<=v_access\.last_payment_due_date/);
 assert.match(sql,/cycle_already_recorded/);
 assert.match(sql,/payment_owned_elsewhere/);
 assert.match(sql,/event_time_not_normalized/);
 assert.match(sql,/into public\.nexus_payments/);
 assert.match(sql,/update public\.organization_product_access/);
 assert.match(sql,/from public,anon,authenticated/);
 assert.match(sql,/to service_role/);
 assert.doesNotMatch(sql,/create user|http|curl|api\.asaas\.com|auth\.users.*insert/i);
});
