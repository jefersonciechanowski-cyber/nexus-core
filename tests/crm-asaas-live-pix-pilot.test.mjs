import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
 LIVE_PIX_AMOUNT_CENTS,LIVE_PIX_AMOUNT_BRL,LIVE_PIX_PROVIDER_HOST,
 LIVE_PIX_CHARGE_CONFIRMATION, validateLivePixApplicant,canRunLivePixPilot,
 safeAsaasProductionInvoice,assertLivePixPayment,assertLivePixCustomer,
 isLivePixExternalReference,
} from '../supabase/functions/_shared/crm-live-pix-pilot.mjs';

const functionSource = readFileSync(new URL('../supabase/functions/nexus-admin-crm-live-pix-pilot/index.ts', import.meta.url),'utf8');
const migrationSource = readFileSync(new URL('../supabase/migrations/20261107110000_crm_live_pix_ten_real_pilot.sql', import.meta.url),'utf8');
const uiSource = readFileSync(new URL('../apps/nexus-admin/crm-live-pix-pilot.html', import.meta.url),'utf8');
const uiControls = readFileSync(new URL('../apps/nexus-admin/crm-live-pix-pilot.js', import.meta.url),'utf8');
const id = '00000000-0000-4000-8000-000000000001';
const pilot = {
 provider_payment_id:'pay_test987654321',provider_customer_id:'cus_test987654321',
 external_reference:'nexus-crm-live-pix-r10-'+id,cpf:'98765432100',
};
const payment = {id:pilot.provider_payment_id,customer:pilot.provider_customer_id,
 externalReference:pilot.external_reference,billingType:'PIX',value:10,status:'RECEIVED',
 subscription:null,installment:null,deleted:false};
const customer = {id:pilot.provider_customer_id,cpfCnpj:pilot.cpf};

test('only exactly R$10 Pix production can be created, never a subscription',()=>{
 assert.equal(LIVE_PIX_AMOUNT_CENTS,1000);
 assert.equal(LIVE_PIX_AMOUNT_BRL,10);
 assert.equal(LIVE_PIX_PROVIDER_HOST,'https://api.asaas.com/v3');
 assert.match(functionSource,/billingType:'PIX',value:LIVE_PIX_AMOUNT_BRL/);
 assert.match(functionSource,/description:'Nexus CRM \| teste real Pix avulso R\$10, sem assinatura'/);
 assert.match(functionSource,/STAGED_LIVE_PIX_DISABLED = true/);
 assert.match(functionSource,/if \(STAGED_LIVE_PIX_DISABLED\) return reply/);
 assert.doesNotMatch(functionSource,/api-sandbox\.asaas\.com/);
 assert.doesNotMatch(uiSource,/ASAAS_PRODUCTION_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
});
test('one valid new real applicant, explicit terms, CPF check digits',()=>{
 const input={companyName:'Teste Privado CRM',responsibleName:'Pessoa Titular',
 email:'titular+novo@example.com',cpf:'987.654.321-00',acceptedOneTimeTerms:true};
 assert.deepEqual(validateLivePixApplicant(input),{
  companyName:'Teste Privado CRM',responsibleName:'Pessoa Titular',
  email:'titular+novo@example.com',cpf:'98765432100',
 });
 assert.equal(validateLivePixApplicant({...input,cpf:'98765432109'}),null);
 assert.equal(validateLivePixApplicant({...input,acceptedOneTimeTerms:false}),null);
 assert.equal(validateLivePixApplicant({...input,email:'not-an-email'}),null);
});
test('production feature and live charge require two independent flags',()=>{
 assert.equal(canRunLivePixPilot({},'charge'),false);
 assert.equal(canRunLivePixPilot({NEXUS_CRM_LIVE_PIX_PILOT_ENABLED:'true'},'prepare'),true);
 assert.equal(canRunLivePixPilot({NEXUS_CRM_LIVE_PIX_PILOT_ENABLED:'true'},'charge'),false);
 assert.equal(canRunLivePixPilot({
  NEXUS_CRM_LIVE_PIX_PILOT_ENABLED:'true',
  NEXUS_CRM_LIVE_PIX_PILOT_CHARGE_ENABLED:'true'},'charge'),true);
 assert.equal(canRunLivePixPilot({NEXUS_CRM_LIVE_PIX_PILOT_ENABLED:'true'},'refund'),false);
 assert.equal(LIVE_PIX_CHARGE_CONFIRMATION,'AUTORIZO COBRANCA REAL PIX DE R$ 10');
 assert.match(functionSource,/body.confirmation !== LIVE_PIX_CHARGE_CONFIRMATION/);
});
test('verification is receipt-bound, production-only, and rejects refunds',()=>{
 assert.deepEqual(assertLivePixPayment(payment,pilot),{ok:true,reason:'received'});
 assert.equal(assertLivePixCustomer(customer,pilot),true);
 assert.equal(assertLivePixCustomer({...customer,cpfCnpj:'11111111111'},pilot),false);
 for(const bad of [
 {status:'PENDING'},{status:'CONFIRMED'},{status:'REFUNDED'},
 {value:79},{value:9.99},{billingType:'BOLETO'},
 {customer:'cus_another'},{externalReference:'different'},
 {subscription:'sub_x'},{installment:'ins_x'}, {deleted:true}
 ]) assert.equal(assertLivePixPayment({...payment,...bad},pilot).ok,false,JSON.stringify(bad));
 assert.equal(safeAsaasProductionInvoice('https://sandbox.asaas.com/i/123'),null);
 assert.equal(safeAsaasProductionInvoice('http://www.asaas.com/i/123'),null);
 assert.equal(safeAsaasProductionInvoice('https://www.asaas.com.evil.com/i/123'),null);
 assert.equal(safeAsaasProductionInvoice('https://www.asaas.com/i/123'),'https://www.asaas.com/i/123');
 assert.equal(isLivePixExternalReference(pilot.external_reference,id),true);
 assert.equal(isLivePixExternalReference('nexus-crm-live-pix-r10-'+id,id.toUpperCase()),false);
});
test('admin-only MFA2, one-winner charge, no retry after uncertain outcome',()=>{
 assert.match(functionSource,/aal\?\.currentLevel !== 'aal2'/);
 assert.match(functionSource,/profile\.role !== 'nexus_admin'/);
 assert.match(functionSource,/eq\('status','prepared'\)\.select\('id'\)/);
 assert.match(functionSource,/live_charge_unknown_check_asaas_before_retry/);
 assert.match(functionSource,/payment_not_received|assertLivePixPayment/);
 assert.match(functionSource,/preflight_nexus_crm_public_identity/);
 assert.match(functionSource,/provisionCrmTenant\(/);
 assert.match(functionSource,/provider_subscription_id:null,billing_mode:'prepaid'/);
 assert.doesNotMatch(functionSource,/console\.log\(.*(cpf|asaasKey|authHeader)/);
});
test('singleton server-only ledger and UI require user action before real charge',()=>{
 assert.match(migrationSource,/slot integer not null unique default 1 check \(slot = 1\)/);
 assert.match(migrationSource,/amount_cents bigint not null default 1000 check \(amount_cents = 1000\)/);
 assert.match(migrationSource,/enable row level security/);
 assert.match(migrationSource,/revoke all on table public\.nexus_crm_live_pix_pilot from public, anon, authenticated/);
 assert.match(migrationSource,/grant select, insert, update on table public\.nexus_crm_live_pix_pilot to service_role/);
 assert.match(uiSource,/type="password" inputmode="numeric"/);
 assert.match(uiControls,/confirm\('Confirma a CRIAÇÃO DE UMA COBRANÇA REAL/);
 assert.match(uiSource,/id="chargeConsent"/);
 assert.match(uiSource,/rel="noopener noreferrer"/);
 assert.doesNotMatch(uiControls,/localStorage|sessionStorage/);
 assert.match(uiControls,/chargeAttempted=true/);
 assert.ok(!uiSource.includes('<script>\n'), 'new admin page should not contain inline JavaScript');
});
