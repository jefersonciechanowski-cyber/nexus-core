import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.1.0';
import { syncCrmEntitlement } from '../stripe-webhook/crm-provisioning.ts';

// Central's dedicated CRM-only trial expiration worker.
// It NEVER attempts to collect payment or converts a courtesy into a plan.
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},
});
Deno.serve(async(request:Request):Promise<Response>=>{
  if(request.method!=='POST')return json({error:'Método não permitido.'},405);
  if(Deno.env.get('NEXUS_CRM_TRIAL_RECONCILE_ENABLED')!=='true') {
    return json({error:'Reconciliação de testes CRM desativada.'},503);
  }
  const supabaseUrl=Deno.env.get('SUPABASE_URL')||'';
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  const bearer=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
  if(!supabaseUrl || serviceKey.length<32 || !bearer)return json({error:'Reconciliador não configurado.'},503);
  // Separate trust boundary from public clients, admin sessions and webhooks.
  try{
    const jwks=createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));
    const {payload}=await jwtVerify(bearer,jwks,{
      issuer:'https://token.actions.githubusercontent.com',audience:'nexus-crm-trial-reconcile',
    });
    if(payload.repository!=='jefersonciechanowski-cyber/nexus-core'
      ||payload.ref!=='refs/heads/main'
      ||!['schedule','workflow_dispatch'].includes(String(payload.event_name))) {
      return json({error:'Identidade de execução não autorizada.'},403);
    }
  }catch{return json({error:'Token interno inválido.'},401);}

  const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:product,error:productError}=await admin.from('nexus_products')
    .select('id').eq('code','crm').eq('status','active').maybeSingle();
  if(productError || !product?.id)return json({error:'Produto CRM indisponível.'},503);
  const today=new Date().toISOString().slice(0,10);
  const {data:expired,error:queryError}=await admin.from('organization_product_access')
    .select('id,renews_at,subscription_status,access_status')
    .eq('product_id',product.id)
    .eq('subscription_status','trial')
    .eq('access_status','active')
    .eq('commercial_condition','standard')
    .is('billing_provider',null)
    .eq('contracted_price_cents',0)
    .lte('renews_at',today)
    .limit(100);
  if(queryError)return json({error:'Falha ao consultar testes vencidos.'},503);
  let suspended=0,synced=0;const failed:string[]=[];
  for(const access of expired||[]){
    try{
      const {data:result,error:rpcError}=await admin.rpc('expire_nexus_crm_trial_access',{
        p_access_id:access.id,p_expected_end:access.renews_at,
      });
      if(rpcError)throw new Error('expiring_rpc_unavailable');
      if(result?.applied!==true)continue;
      suspended++;
      // Deliver the signed Central->CRM entitlement change and queue retry
      // in the existing outbox rather than deleting customer data.
      const delivery=await syncCrmEntitlement(admin,access.id,undefined,new Date().toISOString(),true);
      if(!delivery.isCrm || !delivery.synced)throw new Error('crm_delivery_pending');
      synced++;
    }catch(error){
      failed.push(access.id);
      console.error('crm-trial-reconcile-failed',String((error as Error)?.message||'unknown').slice(0,90));
    }
  }
  return json({date:today,candidates:(expired||[]).length,suspended,synced,
    pending_review:failed.length,failedAccessIds:failed});
});
