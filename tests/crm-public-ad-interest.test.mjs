import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {normalizeCrmInterest,CRM_INTEREST_PLANS} from '../supabase/functions/_shared/crm-public-interest.mjs';

const api=readFileSync(new URL('../supabase/functions/nexus-public-crm-interest/index.ts',import.meta.url),'utf8');
const html=readFileSync(new URL('../crm/index.html',import.meta.url),'utf8');
const checkout=readFileSync(new URL('../supabase/functions/nexus-public-crm-monthly-asaas-production/index.ts',import.meta.url),'utf8');
const sample={
  companyName:'Mercado do Bairro',responsibleName:'Pessoa Responsável',
  phone:'(11) 99999-9999',email:'contato@empresa.test',planCode:'start',
  acceptedContact:true,utmSource:'meta',utmMedium:'paid_social',
  utmCampaign:'crm-ads',utmContent:'criativo-b',
};
test('capture accepts authorized leads and retains only listed attribution fields',()=>{
  const r=normalizeCrmInterest({...sample,price_cents:1,paid:true,
    registrationNumber:'01234567890',organization_id:'untrusted',
    access_status:'active',provider_payment_id:'pay_attack12345'});
  assert.ok(r.payload);
  assert.equal(r.payload.companyName,'Mercado do Bairro');
  assert.equal(r.payload.phone,'11999999999');
  assert.deepEqual(Object.keys(r.payload).sort(),[
    'companyName','responsibleName','phone','email','planCode',
    'utmSource','utmMedium','utmCampaign','utmContent','utmTerm',
  ].sort());
  assert.equal(r.payload.utmSource,'meta');
  assert.equal(r.payload.utmCampaign,'crm-ads');
  assert.equal(Object.hasOwn(r.payload,'paid'),false);
  assert.equal(Object.hasOwn(r.payload,'registrationNumber'),false);
});
test('enquiry rejects invalid phone, no privacy agreement, extra plan, and malformed PII',()=>{
 for(const patch of [
   {acceptedContact:false}, {acceptedContact:'true'}, {planCode:'premium'},
   {phone:'12345'}, {phone:''}, {companyName:'A'},
   {responsibleName:' '}, {email:'invalid@'}, {phone:'1234567890123'},
 ])assert.ok(normalizeCrmInterest({...sample,...patch}).error,JSON.stringify(patch));
 assert.deepEqual(CRM_INTEREST_PLANS,['start','pro','gestao']);
 assert.equal(normalizeCrmInterest({...sample,email:''}).payload?.email,'');
 assert.equal(normalizeCrmInterest({...sample,planCode:''}).payload?.planCode,'');
 assert.equal(normalizeCrmInterest({...sample,website:'bot-spam'}).spam,true);
 assert.ok(normalizeCrmInterest(null).error);
});
test('approved CRM capture is linked without duplicating lead forms or payment services',()=>{
 assert.match(html,/<link rel="canonical" href="https:\/\/crm\.nexuscore\.app\.br\/site-captacao">/);
 assert.match(html,/src="\/crm\/redirect\.js"/);
 assert.match(html,/name="robots" content="noindex,follow"/);
 assert.match(html,/Nexus CRM/);
 assert.doesNotMatch(html,/id="crmInterestForm"/);
 assert.doesNotMatch(html,/id="contato"/);
 assert.doesNotMatch(html,/stripe\.checkout|asaas\.com\/v3\/paymentLinks/);
});

test('API enforces origin, caps payloads and prevents anonymous financial operations',()=>{
 assert.match(api,/PUBLIC_ORIGIN='https:\/\/nexuscore\.app\.br'/);
 assert.match(api,/origin!==PUBLIC_ORIGIN/);
 assert.match(api,/MAX_BODY_BYTES=4096/);
 assert.match(api,/request\.method==='OPTIONS'/);
 assert.match(api,/request\.method!=='POST'/);
 assert.match(api,/content-type/);
 assert.match(api,/p_window_seconds:3600,p_limit:3/);
 assert.match(api,/consume_nexus_public_request_limit/);
 assert.match(api,/\.eq\('phone',lead\.phone\)/);
 assert.match(api,/\.gte\('created_at',since\)/);
 assert.match(api,/sale_status:'lead',lead_stage:'new'/);
 assert.match(api,/product_id:product\.id,plan_id:selectedPlan/);
 assert.match(api,/return_origin:PUBLIC_ORIGIN/);
 assert.match(api,/noPayment:true/);
 assert.doesNotMatch(api,/\/v3\/paymentLinks|\/v3\/payments|fetch\('https:\/\/api\.asaas\.com/);
 assert.doesNotMatch(api,/createUser\(|grantTrial\(|provisionCrmTenant\(|sendCrmAccessEmail/);
 assert.doesNotMatch(api,/provider_payment_id:|provider_checkout_id:|checkout_amount_cents:/);
});
test('commercial protections stay unchanged and cannot create bills from a lead',()=>{
 assert.match(checkout,/const STAGED_ASAAS_PRODUCTION_CHECKOUT_DISABLED = Deno.env.get\('NEXUS_CRM_ASAAS_PROD_RELEASE_APPROVED'\) !== 'true'/);
 assert.match(api,/billing_mode:'recurring',billing_cycle_months:1/);
 assert.match(api,/provider:'asaas',environment:'production'/);
 assert.match(api,/sale_status:'lead'/);
 assert.doesNotMatch(html,/stripe\.checkout|asaas\.com\/v3\/paymentLinks|NEXUS_CRM_ASAAS_PROD_CHECKOUT_BRIDGE_SECRET/);
});
