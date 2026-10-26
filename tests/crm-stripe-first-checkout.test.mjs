import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const central=readFileSync(new URL('../supabase/functions/nexus-public-crm-monthly-checkout/index.ts',import.meta.url),'utf8');
const sql=readFileSync(new URL('../docs/CRM_STRIPE_PUBLIC_IDENTITY_GUARD_SQL_DRAFT.sql',import.meta.url),'utf8');
const contract=readFileSync(new URL('../supabase/functions/nexus-public-crm-monthly-checkout/contract.mjs',import.meta.url),'utf8');

test('monthly Stripe card checkout requires fresh identity before any charge',()=>{
  for(const expr of [
    /preflight_nexus_crm_public_identity/,
    /p_document: input\.registrationNumber/,
    /p_email: input\.email/,
    /identityDecision\?\.eligible !== true/,
    /identityError \? 503 : 409/,
    /nexus_sales'\)\.insert/,
    /stripe\.checkout\.sessions\.create/,
  ]) assert.match(central,expr);
  assert.ok(central.indexOf("preflight_nexus_crm_public_identity")
    < central.indexOf(".from('nexus_sales').insert"));
  assert.ok(central.indexOf("preflight_nexus_crm_public_identity")
    < central.indexOf("stripe.checkout.sessions.create("));
  assert.match(central,/if \(saleError\.code === '23505'\)/);
});

test('existing identities include auth email, agency and CRM registrations',()=>{
  assert.match(sql,/from auth\.users u/);
  assert.match(sql,/from public\.organizations o/);
  assert.match(sql,/pg_catalog\.lower\(u\.email\)=v_email/);
  assert.match(sql,/o\.registration_number/);
  assert.match(sql,/existing_identity/);
  assert.match(sql,/security definer set search_path=''/);
  assert.match(sql,/revoke all on function public\.preflight_nexus_crm_public_identity/);
  assert.match(sql,/to service_role/);
  assert.doesNotMatch(sql,/\bupdate\s+public\.organization_product_access/);
});

test('simultaneous checkouts cannot use a different email or plan to charge same company',()=>{
  assert.match(sql,/create unique index if not exists nexus_crm_stripe_public_unique_doc_idx/);
  assert.match(sql,/create unique index if not exists nexus_crm_stripe_public_unique_email_idx/);
  assert.match(sql,/pg_catalog\.lower\(email\)/);
  assert.match(sql,/sale_status in \('lead','checkout_created','paid','provisioned'\)/);
});

test('live card payment still requires independent gates; no Asaas or courtesy activation',()=>{
  assert.match(contract,/NEXUS_CRM_MONTHLY_CHECKOUT_ENABLED/);
  assert.match(contract,/NEXUS_CRM_LIVE_CHECKOUT_ENABLED/);
  assert.match(contract,/NEXUS_PAYMENT_LIVE_ENABLED/);
  assert.match(contract,/STRIPE_SECRET_KEY\?\.startsWith\('sk_live_'\)/);
  assert.match(central,/payment_method_configuration: methodConfig/);
  assert.match(central,/mode: 'subscription'/);
  assert.match(central,/interval_count: 1/);
  assert.doesNotMatch(central,/grantCourtesy|\.from\('organization_product_access'\)\.insert/);
});
