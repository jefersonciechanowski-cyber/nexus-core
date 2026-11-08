import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {quoteCrmBlackFridayAnnual,buildCrmAsaasBlackFridayAnnualLink} from "../supabase/functions/_shared/crm-asaas-black-friday-annual-contract.mjs";

const saleId="abcd1234-5678-4abc-9def-000000000001";
const plans=[
 {code:"start",name:"Nexus CRM Start",price_cents:7900,annual:79000,savings:15800},
 {code:"pro",name:"Nexus CRM Pro",price_cents:11900,annual:119000,savings:23800},
 {code:"gestao",name:"Nexus CRM Gestão",price_cents:15900,annual:159000,savings:31800},
];
const plan=code=>({...plans.find(p=>p.code===code),status:"active",public_visible:true,currency:"BRL",billing_interval_months:1});

test("Black Friday gives exactly 12 months for 10 month prices from the Central plan",()=>{
 for (const p of plans){
  const x=quoteCrmBlackFridayAnnual(plan(p.code));
  assert.equal(x.monthlyCents,p.price_cents);
  assert.equal(x.annualAmountCents,p.annual);
  assert.equal(x.regularAnnualCents,p.price_cents*12);
  assert.equal(x.savingsCents,p.savings);
  assert.equal(x.billingMode,"prepaid");
  assert.equal(x.billingCycleMonths,12);
  assert.equal(x.autoRenew,false);
 }
});

test("Asaas annual paymentLink is detached, not monthly/annual recurring, and cannot be split",()=>{
 for(const method of ["PIX","BOLETO"]){
  const b=buildCrmAsaasBlackFridayAnnualLink({plan:plan("pro"),method,saleId});
  assert.equal(b.value,1190);
  assert.equal(b.billingType,method);
  assert.equal(b.chargeType,"DETACHED");
  assert.equal(b.limit,1);
  assert.equal(b.subscriptionCycle,undefined);
  assert.equal(b.maxInstallmentCount,undefined);
  assert.equal(b.externalReference,"nexus-crm-bf-annual-"+saleId);
  assert.match(b.description,/sem renovação automática/);
  assert.equal(b.dueDateLimitDays,method==="BOLETO"?7:undefined);
  assert.equal(Object.isFrozen(b),true);
 }
});

test("Never accept annual price, duration or payment method from browser",()=>{
 const p=plan("start");
 for(const unsafe of [
  {...p,price_cents:0},{...p,price_cents:79.9},{...p,billing_interval_months:12},
  {...p,public_visible:false},{...p,status:"inactive"},
  {...p,code:"custom"},{...p,currency:"USD"},
 ]){
   assert.throws(()=>quoteCrmBlackFridayAnnual(unsafe));
 }
 assert.throws(()=>buildCrmAsaasBlackFridayAnnualLink({plan:p,method:"CARD",saleId}));
 assert.throws(()=>buildCrmAsaasBlackFridayAnnualLink({plan:p,method:"PIX",saleId:"invalid"}));
});

test("Existing monthly production checkout remains hard-bound to one-month subscription",()=>{
 const month=readFileSync(new URL("../supabase/functions/nexus-public-crm-monthly-asaas-production/index.ts",import.meta.url),"utf8");
 const verifier=readFileSync(new URL("../supabase/functions/_shared/crm-asaas-production-review.mjs",import.meta.url),"utf8");
 assert.match(month,/billing_mode: 'recurring'/);
 assert.match(month,/billing_cycle_months: 1/);
 assert.match(verifier,/sale\?\.billing_mode !== 'recurring'/);
 assert.match(verifier,/sale\?\.billing_cycle_months !== 1/);
 const annual=readFileSync(new URL("../supabase/functions/_shared/crm-asaas-black-friday-annual-contract.mjs",import.meta.url),"utf8");
 assert.doesNotMatch(annual,/fetch\(|Deno\.serve|admin\.rpc|\.from\('/);
});
