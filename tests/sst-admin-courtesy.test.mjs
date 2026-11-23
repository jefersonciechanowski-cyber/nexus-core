import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';

const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=file('apps/nexus-admin/crm-access.html');
const index=file('apps/nexus-admin/index.html');
const api=file('supabase/functions/nexus-admin-pilot/index.ts');
const expiry=file('supabase/functions/nexus-sst-asaas-reconcile/index.ts');
const sql=file('supabase/migrations/20261123130000_sst_admin_courtesy.sql');
const headers=file('_headers');

test('Central offers SST courtesy without replacing the existing CRM flow',()=>{
  assert.match(index,/Cortesias CRM e SST/);
  for(const id of ['courtesyForm','sstCourtesyForm','sstCourtesyPlan','sstCourtesyDuration','sstRows'])
    assert.match(html,new RegExp('id="'+id+'"'));
  assert.match(html,/data-courtesy-view="crm"/);
  assert.match(html,/data-courtesy-view="sst"/);
  assert.match(html,/mode:'courtesy'/);
  assert.match(html,/functions.invoke\('nexus-admin-pilot'/);
  assert.match(html,/functions.invoke\('nexus-admin-crm-courtesy'/);
  assert.match(html,/\['essencial','profissional','empresarial'\]/);
  assert.match(html,/\.eq\('commercial_condition','courtesy'\)/);
  assert.doesNotThrow(()=>{
    const inline=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
      .map(m=>m[1]).filter(x=>x.trim());
    assert.equal(inline.length,1);
    new Script(inline[0]);
  });
});

test('SST courtesy is an atomic, free, time-limited entitlement with no Asaas charge',()=>{
  assert.match(sql,/create or replace function public.provision_nexus_sst_courtesy/);
  assert.match(sql,/public.provision_nexus_pilot\(/);
  assert.match(sql,/p_duration_months not in \(1,2,3,6,12\)/);
  assert.match(sql,/commercial_condition='courtesy'/);
  assert.match(sql,/contracted_price_cents=0/);
  assert.match(sql,/billing_provider=null/);
  assert.match(sql,/billing_mode='prepaid'/);
  assert.match(sql,/p.customer_type='single_company'/);
  assert.match(sql,/lower\(u.email\)=lower\(btrim\(p_email\)\)/);
  assert.match(sql,/grant execute on function public.provision_nexus_sst_courtesy[\s\S]*?to service_role/);
  assert.match(sql,/revoke all on function public.provision_nexus_sst_courtesy[\s\S]*?from PUBLIC, anon, authenticated/);
  assert.doesNotMatch(sql,/create\s+payment|insert\s+into\s+public.nexus_payment/i);
});

test('SST courtesy creation requires active Nexus administrator and MFA',()=>{
  assert.match(api,/adminProfile.role !== 'nexus_admin'/);
  assert.match(api,/aalData\?\.currentLevel !== 'aal2'/);
  assert.match(api,/provision_nexus_sst_courtesy/);
  assert.match(api,/p_duration_months: durationMonths/);
  assert.match(api,/email_confirm: true/);
  assert.match(api,/sendFirstAccessEmail\(admin, email, responsibleName, companyName, provisioned.validUntil, isCourtesy\)/);
  assert.match(api,/sendPermanentAccessEmail\(email, responsibleName, companyName, provisioned.validUntil, isCourtesy\)/);
  assert.match(sql,/NEXUS_SST_COURTESY_CREATED/);
});

test('expired SST courtesy suspension is audited and preserves customer data',()=>{
  assert.match(sql,/create or replace function public.suspend_expired_nexus_sst_courtesies/);
  assert.match(sql,/commercial_condition='courtesy'/);
  assert.match(sql,/renews_at < v_local_date/);
  assert.match(sql,/NEXUS_SST_COURTESY_EXPIRED/);
  assert.match(expiry,/admin.rpc\('suspend_expired_nexus_sst_courtesies'\)/);
  assert.match(expiry,/expiredTrials,expiredCourtesies/);
  assert.doesNotMatch(sql,/delete\s+from\s+public\.(organizations|profiles|organization_product_access)/i);
});

test('CSP still pins exactly the two updated executable inline scripts',()=>{
  for(const page of [index,html]){
    const inline=[...page.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
      .map(m=>m[1]).filter(x=>x.trim());
    assert.equal(inline.length,1);
    assert.doesNotThrow(()=>new Script(inline[0]));
    const hash=createHash('sha256').update(inline[0]).digest('base64');
    for(const line of headers.split('\n').filter(x=>x.includes('Content-Security-Policy:')))
      assert.ok(line.includes("'sha256-"+hash+"'"),'CSP missing current inline hash');
  }
});
