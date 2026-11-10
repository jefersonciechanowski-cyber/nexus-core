import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const file=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=file('apps/nexus-admin/index.html');
const pilot=file('apps/nexus-admin/pilot.js');
const api=file('supabase/functions/nexus-admin-pilot/index.ts');
const sql=file('supabase/migrations/20261110120000_sst_pilot_evaluation_plan.sql');
const headers=file('_headers');
const leads=file('apps/nexus-admin/leads.html');
const accounts=file('apps/nexus-admin/accounts.html');

test('15-day SST trial evaluates a selected tier, never becomes a paid contract',()=>{
  assert.match(sql,/add column if not exists pilot_target_plan_id uuid/);
  assert.match(sql,/provision_nexus_pilot_with_plan/);
  assert.match(sql,/v_result := public\.provision_nexus_pilot\(/);
  assert.match(sql,/update public\.organization_product_access/);
  assert.match(sql,/pilot_target_plan_id=v_target/);
  assert.match(sql,/revoke all on function public\.provision_nexus_pilot_with_plan/);
  assert.match(sql,/grant execute on function public\.provision_nexus_pilot_with_plan[\s\S]*?to service_role/);
  for(const code of ['essencial','profissional','empresarial']){
    assert.ok(sql.includes("'"+code+"'"));
    assert.ok(api.includes("'"+code+"'"));
    assert.ok(pilot.includes('value="'+code+'"'));
  }
  assert.match(sql,/coalesce\(target_plan\.employee_limit,plan\.employee_limit\)/);
  assert.match(sql,/access\.subscription_status = ''trial''/);
  assert.match(api,/p_target_plan_code: targetPlanCode/);
  assert.match(api,/p_days: days/);
});

test('Nexus Central navigation order is identical across commercial sections',()=>{
  for(const page of [html,leads,accounts]){
    const labels=['Visão Geral','CRM Comercial','Contas e Consultorias','Clientes e Acessos','Produtos e Planos','Pagamentos'];
    let last=-1;
    const nav=page.match(/<nav class="nav"[\s\S]*?<\/nav>/)?.[0];
    assert.ok(nav,'Missing sidebar navigation');
    for(const label of labels){
      const next=nav.indexOf(label);
      assert.ok(next>last,'Sidebar item missing or out of order: '+label);
      last=next;
    }
    assert.ok(page.includes('href="admin-management.css"'));
  }
  for(const page of [leads,accounts]){
    for(const hash of ['clients','products','payments'])assert.ok(page.includes('href="index.html#'+hash+'"'));
  }
});

test('changing section preserves rows and existing scroll positions',()=>{
  const before=html.indexOf('function setView(view){');
  const end=html.indexOf('function filteredOverview()',before);
  assert.ok(before>0&&end>before);
  const viewHandler=html.slice(before,end);
  assert.doesNotMatch(viewHandler,/renderAll\(\)/);
  assert.match(viewHandler,/history\.replaceState/);
  assert.match(html,/window\.addEventListener\('hashchange'/);
  assert.doesNotMatch(pilot,/MutationObserver/);
  assert.match(html,/newPilotShortcut/);
});

test('SST pilot labels do not falsely show annual paid contracts',()=>{
  assert.match(html,/const expiredPilot=/);
  assert.match(html,/r\.subscription_status==='trial'\?'Gratuito'/);
  assert.match(html,/Piloto encerrado/);
  assert.match(html,/pilot_target_plan_id,access_status/);
  assert.match(html,/employee_limit'\)/);
});

test('content-security policy pins the updated admin script hash',()=>{
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)]
    .map(m=>m[1]).filter(s=>s.trim().length>0);
  assert.equal(scripts.length,1);
  const digest=createHash('sha256').update(scripts[0]).digest('base64');
  assert.ok(headers.includes("'sha256-"+digest+"'"),'Updated admin inline script blocked by CSP');
  assert.match(html,/src="pilot\.js"/);
});
