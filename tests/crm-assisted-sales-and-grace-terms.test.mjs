import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sales=readFileSync(new URL('../crm/index.html',import.meta.url),'utf8');
const terms=readFileSync(new URL('../crm/termos.html',import.meta.url),'utf8');
const checkout=readFileSync(new URL('../supabase/functions/nexus-public-crm-monthly-asaas-production/index.ts',import.meta.url),'utf8');
const provider=readFileSync(new URL('../supabase/functions/_shared/crm-asaas-monthly-contract.mjs',import.meta.url),'utf8');

test('all three CRM plans offer assisted contact without a payment request',()=>{
 assert.deepEqual(['Start','Pro','Gestão'].map(plan=>
   sales.includes('Solicitar contratação assistida do Nexus CRM '+plan)),[true,true,true]);
 assert.equal((sales.match(/>Solicitar contratação<\/a>/g)||[]).length,3);
 assert.match(sales,/Contratação assistida/);
 assert.match(sales,/nenhum pagamento, assinatura ou acesso é criado/);
 assert.match(sales,/checkout automático está em homologação/);
 assert.doesNotMatch(sales,/checkout\.sessions\.create|ASAAS_PRODUCTION_API_KEY/);
 assert.match(sales,/fetch\('https:\/\/svphwbccqeoakpmcpvhy\.supabase\.co\/functions\/v1\/nexus-public-crm-interest'/);
 assert.match(sales,/Nenhuma cobrança foi gerada/);
 assert.doesNotMatch(sales,/checkout\.stripe\.com|api\.asaas\.com\/v3/);
 for(const [name,slug] of [['Start','start'],['Pro','pro'],['Gestão','gestao']]){
  assert.match(sales,new RegExp('href="#contato" data-plan="'+slug+'" aria-label="Solicitar contratação assistida do Nexus CRM '+name+'"'));
 }
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
 assert.match(checkout,/STAGED_ASAAS_PRODUCTION_CHECKOUT_DISABLED = true/);
 assert.match(checkout,/NEXUS_CRM_ASAAS_PROD_WEBHOOK_CONFIRMED/);
 assert.match(provider,/notificationEnabled: true/);
 assert.match(sales,/mailto:suporte@nexuscore\.app\.br\?subject=/);
 assert.doesNotMatch(sales,/<form[^>]*id="checkoutForm"/);
});
