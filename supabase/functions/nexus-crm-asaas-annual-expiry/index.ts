import {createClient} from 'npm:@supabase/supabase-js@2.112.3';
import {createRemoteJWKSet,jwtVerify} from 'npm:jose@6.1.0';
import {syncCrmEntitlement} from '../stripe-webhook/crm-provisioning.ts';

// Daily OIDC worker: only paid Asaas annual prepaid CRM, no auto charges.
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json','cache-control':'no-store'},
});
Deno.serve(async(request:Request)=>{
  if(Deno.env.get('NEXUS_CRM_ASAAS_PROD_ANNUAL_EXPIRY_ENABLED')!=='true'
    ||Deno.env.get('NEXUS_CRM_ASAAS_PROD_ANNUAL_RELEASE_APPROVED')!=='true')
    return json({error:'Expiração anual em homologação.'},503);
  if(request.method!=='POST')return json({error:'Método não permitido.'},405);
  const bearer=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim();
  if(!bearer||bearer.length>10000)return json({error:'Não autorizado.'},401);
  try{
    const jwks=createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));
    const {payload}=await jwtVerify(bearer,jwks,{
      issuer:'https://token.actions.githubusercontent.com',audience:'nexus-crm-asaas-annual-expiry',
    });
    if(payload.repository!=='jefersonciechanowski-cyber/nexus-core'
      ||payload.ref!=='refs/heads/main'||payload.ref_type!=='branch'
      ||payload.workflow_ref!=='jefersonciechanowski-cyber/nexus-core/.github/workflows/crm-asaas-annual-expiry.yml@refs/heads/main'
      ||!['schedule','workflow_dispatch'].includes(String(payload.event_name||'')))
      return json({error:'Execução não autorizada.'},403);
  }catch{return json({error:'Token interno inválido.'},401);}
  const url=Deno.env.get('SUPABASE_URL')||'';
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  if(!url||key.length<30)return json({error:'Serviço indisponível.'},503);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:product,error:productError}=await admin.from('nexus_products')
    .select('id').eq('code','crm').eq('status','active').maybeSingle();
  if(productError||!product?.id)return json({error:'CRM indisponível.'},503);
  const today=new Date().toISOString().slice(0,10);
  const {data:annual,error:queryError}=await admin.from('organization_product_access')
    .select('id,renews_at').eq('product_id',product.id)
    .eq('billing_provider','asaas').eq('billing_mode','prepaid').eq('billing_cycle_months',12)
    .eq('subscription_status','active').eq('access_status','active')
    .eq('commercial_condition','standard').is('provider_subscription_id',null)
    .lt('renews_at',today).limit(100);
  if(queryError)return json({error:'Consulta de vencimentos indisponível.'},503);
  let suspended=0,synced=0,review=0;
  for(const access of annual||[]){
    try{
      const {data:expired,error:expError}=await admin.rpc('expire_nexus_crm_asaas_prepaid_access',{
        p_access_id:access.id,
      });
      if(expError)throw Error('expiry_rpc_failed');
      if(expired?.applied!==true){review++;continue;}
      suspended++;
      const delivered=await syncCrmEntitlement(admin,access.id,undefined,new Date().toISOString(),true);
      if(!delivered.isCrm||!delivered.synced)throw Error('crm_delivery_pending');
      synced++;
    }catch{review++;console.error('crm_annual_expiry_requires_review');}
  }
  return json({date:today,inspected:(annual||[]).length,suspended,synced,pending_review:review});
});
