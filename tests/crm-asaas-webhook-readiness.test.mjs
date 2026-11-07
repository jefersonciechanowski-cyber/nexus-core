import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {REQUIRED_CRM_ASAAS_EVENTS,assessCrmAsaasProductionWebhook}
 from '../supabase/functions/_shared/crm-asaas-webhook-readiness.mjs';
import {normalizeCrmAsaasEventDate,sanitizeCrmAsaasEvent}
 from '../supabase/functions/_shared/crm-asaas-events.mjs';
import {decideCrmAsaasLifecycle}
 from '../supabase/functions/_shared/crm-asaas-lifecycle.mjs';

const url='https://svphwbccqeoakpmcpvhy.supabase.co/functions/v1/nexus-crm-asaas-production-events';
const row={url,enabled:true,interrupted:false,events:[...REQUIRED_CRM_ASAAS_EVENTS],
  authToken:'NEVER_RETURN_ME',email:'private@example.com'};
const view=(entries,token=true)=>assessCrmAsaasProductionWebhook(entries,url,token);
test('Asaas read-only diagnostic handles missing, disabled and duplicate production receivers',()=>{
 assert.equal(view([]).status,'webhook_not_registered');
 assert.equal(view([{...row,url:'https://other.example.com/webhook'}]).registered,false);
 assert.equal(view([{...row,enabled:false}]).status,'webhook_disabled');
 assert.equal(view([{...row,interrupted:true}]).status,'webhook_interrupted');
 assert.equal(view([row,row]).status,'duplicate_webhook_configuration');
 assert.equal(view(null).status,'provider_response_invalid');
});
test('Asaas diagnostic demands exact required events and a dedicated server-only token',()=>{
 assert.equal(view([{...row,events:['PAYMENT_RECEIVED']}]).status,'missing_webhook_events');
 assert.equal(view([row],false).status,'receiver_token_not_configured');
 const present=view([row],true);
 assert.equal(present.status,'configuration_detected_receiver_still_blocked');
 assert.equal(present.registered,true);
 assert.equal(present.eventsCovered,true);
 assert.deepEqual(present.missingEvents,[]);
 assert.ok(!JSON.stringify(present).includes('NEVER_RETURN_ME'));
 assert.ok(!JSON.stringify(present).includes('private@example.com'));
 assert.ok(!JSON.stringify(present).includes(url));
});
test('Asaas real webhook date format is safely normalized, invalid or ambiguous is refused',()=>{
 assert.equal(normalizeCrmAsaasEventDate('2026-11-07 16:45:03'),
   '2026-11-07T16:45:03-03:00');
 assert.equal(normalizeCrmAsaasEventDate('2026-11-07T19:45:03Z'),
   '2026-11-07T19:45:03Z');
 assert.equal(normalizeCrmAsaasEventDate('2026-02-30 16:45:03'),null);
 assert.equal(normalizeCrmAsaasEventDate('2026-11-07'),null);
 assert.equal(normalizeCrmAsaasEventDate('nonsense'),null);
});
test('official Asaas payment payload is minimized while preserving stable ID and order',()=>{
 const raw={
  id:'evt_05b708f961d739ea7eba7e4db318f621&368604920',
  event:'PAYMENT_RECEIVED',dateCreated:'2026-11-07 16:45:03',
  payment:{object:'payment',id:'pay_080225913252',paymentLink:'123517639363',
    subscription:'sub_VXJBYgP2u0eO',status:'RECEIVED',billingType:'PIX',
    value:79,customer:'cus_G7Dvo4iphUNk',email:'private@example.com',
    cpfCnpj:'12345678909'},
 };
 const a=sanitizeCrmAsaasEvent(raw),b=sanitizeCrmAsaasEvent(raw);
 assert.equal(a.provider_event_id,'asaas:'+raw.id);
 assert.equal(a.payload.dateCreated,'2026-11-07T16:45:03-03:00');
 assert.equal(a.payload.resource.paymentLink,'123517639363');
 assert.equal(a.payload.resource.subscription,'sub_VXJBYgP2u0eO');
 assert.deepEqual(a,b);
 assert.ok(!JSON.stringify(a).includes('private@example.com'));
 assert.ok(!JSON.stringify(a).includes('12345678909'));
});
test('normalized provider event time can be compared by lifecycle without bypassing lease',()=>{
 const raw=sanitizeCrmAsaasEvent({
  id:'evt_prodfuture12345',event:'PAYMENT_RECEIVED',
  dateCreated:'2026-11-07 16:45:03',payment:{
   id:'pay_prodpayment123',subscription:'sub_prodsub123',
   billingType:'PIX',value:79,status:'RECEIVED'},
 });
 const outcome=decideCrmAsaasLifecycle({
  environment:'production',
  event:{...raw,occurredAt:raw.payload.dateCreated,relatedPaymentId:'pay_prodpayment123'},
  sale:{provider:'asaas',environment:'production',billing_mode:'recurring',billing_cycle_months:1,
    organization_id:'org-1',asaas_subscription_id:'sub_prodsub123'},
  access:{billing_provider:'asaas',billing_mode:'recurring',commercial_condition:'standard',
    product_code:'crm',organization_id:'org-1',provider_subscription_id:'sub_prodsub123',
    subscription_status:'past_due',knownProviderPaymentId:'pay_prodpayment123',
    contracted_price_cents:7900},
  payment:{id:'pay_prodpayment123',subscription:'sub_prodsub123',value:79,status:'RECEIVED'},
  subscription:{id:'sub_prodsub123',status:'ACTIVE'},
  now:'2026-11-07T20:00:00Z'
 });
 assert.deepEqual([outcome.decision,outcome.action],['candidate','reactivate']);
});
test('admin-only webhook audit is restricted, GET-only and never leaks provider tokens',()=>{
 const src=readFileSync(new URL('../supabase/functions/nexus-admin-asaas-production-health/index.ts',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../apps/nexus-admin/crm-live-pix-pilot.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../apps/nexus-admin/crm-live-pix-pilot.js',import.meta.url),'utf8');
 assert.match(src,/getAuthenticatorAssuranceLevel\(accessToken\)/);
 assert.match(src,/level\?\.currentLevel !== 'aal2'/);
 assert.match(src,/profile\?\.role !== 'nexus_admin'/);
 assert.match(src,/action==='webhooks'/);
 assert.match(src,/fetch\(ASAAS_BASE \+ '\/webhooks\?limit=100'/);
 assert.match(src,/assessCrmAsaasProductionWebhook\(entries,expected,secretOk\)/);
 assert.match(src,/receiverBlocked:true/);
 assert.match(src,/tokenVerifiedByDelivery:false/);
 assert.match(js,/body:\{action:'webhooks'\}/);
 assert.match(ui,/id="webhookCheck"/);
 assert.doesNotMatch(src,/method:\s*'POST'[\s\S]*fetch\(|\/webhooks'\s*,\s*\{\s*method:\s*'POST'/);
 assert.doesNotMatch(src,/console\.(log|error|warn)\(/);
 assert.doesNotMatch(js,/SUPABASE_SERVICE_ROLE_KEY|ASAAS_PRODUCTION_API_KEY/);
});
