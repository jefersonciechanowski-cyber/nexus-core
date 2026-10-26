// Offline Deno integration tests against the REAL Central sender.
// Fake Supabase result sets and intercepted fetch only; no network access.
import assert from 'node:assert/strict';
import { syncCrmEntitlement } from '../supabase/functions/stripe-webhook/crm-provisioning.ts';

const webhookSecret = 'central-to-crm-hmac-ci-only-not-a-real-secret-2026';
const accessId = '11111111-2222-4333-8444-555555555555';
const orgId = '22222222-3333-4444-8555-666666666666';
const tenantId = '33333333-4444-4555-8666-777777777777';
const official = 'https://ngxqtztfotkpdvynstae.supabase.co/functions/v1/nexus-central-entitlement';

function fakeDatabase({status='suspended', commercialCondition='standard', pending=true}={}) {
  const calls: Array<{name:string, args:Record<string,unknown>}> = [];
  const rows: Record<string, Record<string,unknown>> = {
    organization_product_access: {
      id: accessId, organization_id:orgId, product_id:'product',
      plan_id:'plan', access_status: status === 'active'?'active':'suspended',
      subscription_status: status === 'cancelled'?'cancelled':status==='active'?'active':'past_due',
      contracted_price_cents:7900,commercial_condition:commercialCondition,
      additional_users:0, base_user_limit_override:null,starts_at:'2026-10-01',
      renews_at:'2026-11-01',external_tenant_id:tenantId,
    },
    nexus_products: {id:'product',code:'crm'},
    nexus_plans: {id:'plan',code:'start',price_cents:7900,included_user_limit:3,status:'active'},
  };
  const admin = {
    from(table:string){
      if(!(table in rows)) throw Error('Unexpected table: '+table);
      return {select(_fields:string){
        return {eq(_column:string,_id:string){
          return {maybeSingle:async()=>({data:rows[table],error:null})};
        }};
      }};
    },
    async rpc(name:string,args:Record<string,unknown>){
      calls.push({name,args});
      if(name==='ensure_crm_sync_delivery'){
        return {data:{is_crm:true,revision:7,confirmed_revision:pending?6:7,pending},error:null};
      }
      if(['confirm_crm_sync_delivery','fail_crm_sync_delivery'].includes(name)){
        return {data:{ok:true},error:null};
      }
      throw Error('Unexpected RPC: '+name);
    },
  };
  return {admin,calls};
}

async function validSignature(raw:string,signatureHeader:string) {
  assert.match(signatureHeader,/^sha256=[0-9a-f]{64}$/);
  const encoded=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',encoded.encode(webhookSecret),
    {name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes=Uint8Array.from(signatureHeader.slice(7).match(/../g)!,value=>parseInt(value,16));
  return crypto.subtle.verify('HMAC',key,bytes,encoded.encode(raw));
}

async function runWithFetch(
  handler:(url:string,init:RequestInit)=>Promise<Response>,
  run:()=>Promise<void>,
) {
  const original=globalThis.fetch;
  const oldUrl=Deno.env.get('NEXUS_CRM_ENTITLEMENT_URL');
  const oldSecret=Deno.env.get('NEXUS_CENTRAL_WEBHOOK_SECRET');
  Deno.env.set('NEXUS_CENTRAL_WEBHOOK_SECRET',webhookSecret);
  Deno.env.delete('NEXUS_CRM_ENTITLEMENT_URL');
  globalThis.fetch=((url:RequestInfo|URL,init?:RequestInit)=>
    handler(String(url),init||{})) as typeof fetch;
  try{await run();}
  finally{
    globalThis.fetch=original;
    if(oldUrl===undefined)Deno.env.delete('NEXUS_CRM_ENTITLEMENT_URL');
    else Deno.env.set('NEXUS_CRM_ENTITLEMENT_URL',oldUrl);
    if(oldSecret===undefined)Deno.env.delete('NEXUS_CENTRAL_WEBHOOK_SECRET');
    else Deno.env.set('NEXUS_CENTRAL_WEBHOOK_SECRET',oldSecret);
  }
}

Deno.test('Central signs the exact CRM entitlement payload; only a confirmed revision is acked',async()=>{
  const {admin,calls}=fakeDatabase();
  await runWithFetch(async(url,init)=>{
    assert.equal(url,official);
    assert.equal(init.method,'POST');
    const raw=String(init.body);
    const headers=new Headers(init.headers);
    assert.equal(await validSignature(raw,headers.get('x-nexus-signature')||''),true);
    const message=JSON.parse(raw);
    assert.equal(message.organization_id,tenantId);
    assert.equal(message.central_company_id,orgId);
    assert.equal(message.contract_id,accessId);
    assert.equal(message.event_type,'entitlement.suspended');
    assert.equal(message.entitlement.status,'suspended');
    assert.equal(message.entitlement.commercial_condition,'standard');
    assert.equal(message.entitlement.base_price_cents,7900);
    assert.equal(message.revision,7);
    return new Response(JSON.stringify({ok:true,confirmed_revision:7}),{status:200});
  },async()=>{
    const result=await syncCrmEntitlement(admin,accessId);
    assert.equal(result.synced,true);
    assert.equal(result.revision,7);
    assert.deepEqual(calls.map(x=>x.name),['ensure_crm_sync_delivery','confirm_crm_sync_delivery']);
    assert.equal(calls[1].args.p_revision,7);
  });
});

Deno.test('courtesy remains courtesy in signed snapshot; cancellation does not delete tenant',async()=>{
  const {admin,calls}=fakeDatabase({status:'cancelled',commercialCondition:'courtesy'});
  await runWithFetch(async(_url,init)=>{
    const payload=JSON.parse(String(init.body));
    assert.equal(payload.entitlement.commercial_condition,'courtesy');
    assert.equal(payload.event_type,'entitlement.cancelled');
    assert.equal(payload.entitlement.status,'cancelled');
    assert.equal(payload.organization_id,tenantId);
    return new Response(JSON.stringify({ok:true,confirmed_revision:7}),{status:200});
  },async()=>{
    const result=await syncCrmEntitlement(admin,accessId);
    assert.equal(result.synced,true);
    assert.equal(calls.filter(x=>x.name==='confirm_crm_sync_delivery').length,1);
  });
});

Deno.test('network error leaves revision pending, same revision retries then confirms',async()=>{
  const {admin,calls}=fakeDatabase();
  let attempts=0;
  await runWithFetch(async()=>{
    attempts++;
    if(attempts===1)throw Error('Synthetic network timeout');
    return new Response(JSON.stringify({ok:true,confirmed_revision:7}),{status:200});
  },async()=>{
    const first=await syncCrmEntitlement(admin,accessId);
    assert.equal(first.synced,false);
    assert.equal(first.revision,7);
    const second=await syncCrmEntitlement(admin,accessId);
    assert.equal(second.synced,true);
    assert.equal(second.revision,7);
    assert.deepEqual(calls.map(x=>x.name),[
      'ensure_crm_sync_delivery','fail_crm_sync_delivery',
      'ensure_crm_sync_delivery','confirm_crm_sync_delivery']);
  });
});

Deno.test('stale/invalid CRM acknowledgment can never confirm delivery revision',async()=>{
  for(const response of [
    new Response(JSON.stringify({ok:true,confirmed_revision:6}),{status:200}),
    new Response(JSON.stringify({ok:false,confirmed_revision:7}),{status:200}),
    new Response('synthetic server failure',{status:503}),
  ]){
    const {admin,calls}=fakeDatabase();
    await runWithFetch(async()=>response,async()=>{
      const result=await syncCrmEntitlement(admin,accessId);
      assert.equal(result.synced,false);
      assert.equal(calls.some(x=>x.name==='confirm_crm_sync_delivery'),false);
      assert.equal(calls.some(x=>x.name==='fail_crm_sync_delivery'),true);
    });
  }
});

Deno.test('arbitrary configured HTTPS endpoints cannot receive signed CRM data',async()=>{
  const {admin,calls}=fakeDatabase();
  let invoked=false;
  await runWithFetch(async()=>{
    invoked=true;
    throw Error('Should not be called');
  },async()=>{
    Deno.env.set('NEXUS_CRM_ENTITLEMENT_URL','https://attacker.invalid/record');
    const result=await syncCrmEntitlement(admin,accessId);
    assert.equal(result.synced,false);
    assert.match(result.error||'',/Destino da sincronização CRM não autorizado/);
    assert.equal(invoked,false);
    assert.equal(calls.length,0);
  });
});

Deno.test('already confirmed revision avoids re-sending event',async()=>{
  const {admin,calls}=fakeDatabase({pending:false});
  await runWithFetch(async()=>{throw Error('Must not send a confirmed revision');},async()=>{
    const result=await syncCrmEntitlement(admin,accessId);
    assert.equal(result.synced,true);
    assert.equal(result.revision,7);
    assert.deepEqual(calls.map(x=>x.name),['ensure_crm_sync_delivery']);
  });
});
