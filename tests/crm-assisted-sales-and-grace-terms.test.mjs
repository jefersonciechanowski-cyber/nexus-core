import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sales=readFileSync(new URL('../crm/index.html',import.meta.url),'utf8');
const terms=readFileSync(new URL('../crm/termos.html',import.meta.url),'utf8');
const checkout=readFileSync(new URL('../supabase/functions/nexus-public-crm-monthly-asaas-production/index.ts',import.meta.url),'utf8');
const provider=readFileSync(new URL('../supabase/functions/_shared/crm-asaas-monthly-contract.mjs',import.meta.url),'utf8');

test('wrong duplicate /crm page cannot initiate checkout, take leads or override approved marketing',()=>{
 assert.match(sales,/https:\/\/crm\.nexuscore\.app\.br\/site-captacao/);
 assert.match(sales,/src="\/crm\/redirect\.js"/);
 assert.match(sales,/name="robots" content="noindex,follow"/);
 assert.doesNotMatch(sales,/checkout\.sessions\.create|ASAAS_PRODUCTION_API_KEY/);
 assert.doesNotMatch(sales,/<form|id="crmInterestForm"|action="\/api\/public\/crm-checkout"/);
 assert.doesNotMatch(sales,/checkout\.stripe\.com|api\.asaas\.com\/v3/);
});
test('CRM consumer terms match operator-approved seven calendar days',()=>{
 assert.match(terms,/7 dias corridos após o vencimento/);
 assert.match(terms,/não ocasiona suspensão do acesso/);
 assert.match(terms,/O cliente deverá ser avisado do atraso/);
 assert.match(terms,/análise e decisão administrativa/);
 assert.match(terms,/após confirmação do pagamento, registro financeiro e sincronização/);
 assert.match(terms,/Estornos e cancelamentos exigem avaliação específica/);
});
test('editing assisted sales does not lift live checkout gate or silently enable Asaas fees',()=>{
 assert.match(checkout,/STAGED_ASAAS_PRODUCTION_CHECKOUT_DISABLED = Deno.env.get\('NEXUS_CRM_ASAAS_PROD_RELEASE_APPROVED'\) !== 'true'/);
 assert.match(checkout,/NEXUS_CRM_ASAAS_PROD_WEBHOOK_CONFIRMED/);
 assert.match(provider,/notificationEnabled: true/);
 assert.match(sales,/https:\/\/crm\.nexuscore\.app\.br\/site-captacao/);
 assert.doesNotMatch(sales,/<form[^>]*id="checkoutForm"/);
});
