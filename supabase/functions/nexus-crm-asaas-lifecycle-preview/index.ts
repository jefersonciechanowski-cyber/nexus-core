import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { trustedAsaasToken } from '../_shared/crm-asaas-events.mjs';
import { previewCrmAsaasLifecycle } from '../_shared/crm-asaas-lifecycle-preview.mjs';

// Private diagnostic endpoint; not an Asaas webhook, billing worker or job.
// Disabled by default. No SQL RPC, mutation, invoice or tenant write.
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},
});
const safeId=(value:unknown,prefix:string)=>typeof value==='string'
  && new RegExp('^'+prefix+'_[A-Za-z0-9_-]{5,120}$').test(value);
const safeSubscription=(value:unknown)=>safeId(value,'sub');

async function readBody(req:Request):Promise<string|null>{
  if(!(req.headers.get('content-type')||'').toLowerCase().startsWith('application/json')
    || Number(req.headers.get('content-length')||'0')>2048 || !req.body) return null;
  try{
    const reader=req.body.getReader();
    const chunks:Uint8Array[]=[];let total=0;
    while(true){
      const chunk=await reader.read();
      if(chunk.done)break;
      total+=chunk.value?.length||0;
      if(total>2048)return null;
      if(chunk.value)chunks.push(chunk.value);
    }
    const joined=new Uint8Array(total);let at=0;
    for(const chunk of chunks){joined.set(chunk,at);at+=chunk.length;}
    return new TextDecoder('utf-8',{fatal:true}).decode(joined);
  }catch{return null;}
}

Deno.serve(async(req:Request):Promise<Response>=>{
  if(req.method!=='POST')return json({error:'Método não permitido.'},405);
  if(Deno.env.get('NEXUS_CRM_ASAAS_LIFECYCLE_PREVIEW_ENABLED')!=='true'
    || Deno.env.get('NEXUS_CRM_ASAAS_MONTHLY_MODE')!=='sandbox') {
    return json({error:'Prévia do ciclo de cobrança desativada.'},503);
  }
  const secret=Deno.env.get('NEXUS_CRM_ASAAS_LIFECYCLE_PREVIEW_SECRET')||'';
  if(secret===(Deno.env.get('ASAAS_SANDBOX_API_KEY')||'')
    || secret===(Deno.env.get('NEXUS_CRM_ASAAS_VERIFY_SECRET')||'')
    || !trustedAsaasToken(req.headers.get('x-nexus-asaas-lifecycle-preview-key'),secret)) {
    return json({error:'Não autorizado.'},401);
  }
  const raw=await readBody(req);
  if(raw===null)return json({error:'Corpo inválido.'},400);
  let input:Record<string,unknown>;
  try{input=JSON.parse(raw);}catch{return json({error:'JSON inválido.'},400);}
  if(!input || typeof input!=='object' || Array.isArray(input)
    || Object.keys(input).length!==1 || typeof input.eventId!=='string'
    || !/^asaas:evt_[A-Za-z0-9_&.-]{6,150}$/.test(input.eventId)) {
    return json({error:'Evento inválido.'},400);
  }

  const url=Deno.env.get('SUPABASE_URL')||'';
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  const asaasKey=Deno.env.get('ASAAS_SANDBOX_API_KEY')||'';
  if(!url || key.length<30 || asaasKey.length<20) {
    return json({error:'Sandbox não configurado.'},503);
  }
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:eventRow,error:eventError}=await admin.from('nexus_payment_webhook_events')
    .select('provider_event_id,provider,event_type,resource_id,payload,created_at')
    .eq('provider_event_id',input.eventId).eq('provider','asaas').maybeSingle();
  if(eventError)return json({decision:'retry',reason:'event_read_failed',readOnly:true,canActivateCrm:false},503);
  if(!eventRow)return json({decision:'manual_review',reason:'event_not_found',readOnly:true,canActivateCrm:false},404);

  const resource=eventRow.payload?.resource;
  const subscriptionId=eventRow.event_type?.startsWith('SUBSCRIPTION_')
    ?resource?.id:resource?.subscription;
  if(!safeSubscription(subscriptionId)) {
    return json({decision:'manual_review',reason:'subscription_not_linked',readOnly:true,canActivateCrm:false});
  }
  const {data:accesses,error:accessError}=await admin.from('organization_product_access')
    .select('id,organization_id,product_id,external_tenant_id,billing_provider,billing_mode,commercial_condition,provider_customer_id,provider_subscription_id,contracted_price_cents,subscription_status,access_status,provider_state_event_id,provider_state_event_created_at')
    .eq('provider_subscription_id',subscriptionId).eq('billing_provider','asaas').limit(2);
  if(accessError)return json({decision:'retry',reason:'access_read_failed',readOnly:true,canActivateCrm:false},503);
  if(!accesses || accesses.length!==1) {
    return json({decision:'manual_review',reason:'access_not_unique',readOnly:true,canActivateCrm:false});
  }
  const access=accesses[0];
  const {data:products,error:productError}=await admin.from('nexus_products')
    .select('code').eq('id',access.product_id).limit(2);
  if(productError)return json({decision:'retry',reason:'product_read_failed',readOnly:true,canActivateCrm:false},503);
  if(!products || products.length!==1 || products[0].code!=='crm') {
    return json({decision:'manual_review',reason:'not_crm_product',readOnly:true,canActivateCrm:false});
  }

  const {data:sales,error:saleError}=await admin.from('nexus_sales')
    .select('id,product_id,organization_id,provider,environment,sale_status,provisioned_at,billing_mode,billing_cycle_months,asaas_subscription_id,provider_customer_id,registration_number')
    .eq('organization_id',access.organization_id).eq('product_id',access.product_id)
    .eq('provider','asaas').eq('environment','sandbox')
    .eq('asaas_subscription_id',subscriptionId).eq('sale_status','provisioned').limit(2);
  if(saleError)return json({decision:'retry',reason:'sale_read_failed',readOnly:true,canActivateCrm:false},503);
  if(!sales || sales.length!==1) {
    return json({decision:'manual_review',reason:'sale_not_unique',readOnly:true,canActivateCrm:false});
  }

  let receipt=null;
  if(eventRow.event_type?.startsWith('PAYMENT_')){
    if(!safeId(resource?.id,'pay')) {
      return json({decision:'manual_review',reason:'payment_id_invalid',readOnly:true,canActivateCrm:false});
    }
    const {data:receipts,error:receiptError}=await admin.from('nexus_payments')
      .select('id,provider,provider_payment_id,provider_subscription_id,organization_id,access_id,currency,amount_cents')
      .eq('provider','asaas').eq('provider_payment_id',resource.id)
      .eq('access_id',access.id).eq('organization_id',access.organization_id).limit(2);
    if(receiptError)return json({decision:'retry',reason:'receipt_read_failed',readOnly:true,canActivateCrm:false},503);
    if(!receipts || receipts.length!==1) {
      return json({decision:'manual_review',reason:'payment_not_in_verified_ledger',readOnly:true,canActivateCrm:false});
    }
    receipt=receipts[0];
  }

  const fetchResource=async(path:string)=>{
    // Never accept a custom host/URL: only safe provider resource IDs.
    if(!/^\/(payments|customers|subscriptions)\/[A-Za-z0-9_-]{5,130}$/.test(path)) {
      throw Error('invalid_provider_path');
    }
    const response=await fetch('https://api-sandbox.asaas.com/v3'+path,{
      method:'GET',headers:{accept:'application/json',access_token:asaasKey,
        'User-Agent':'NexusCRM-SandboxLifecyclePreview/1.0'},
      signal:AbortSignal.timeout(8000),
    });
    if(!response.ok)throw Error('provider_unavailable');
    if(Number(response.headers.get('content-length')||'0')>30000)throw Error('provider_too_large');
    const body=await response.text();
    if(body.length>30000)throw Error('provider_too_large');
    return JSON.parse(body);
  };
  const decision=await previewCrmAsaasLifecycle({
    eventRow,sale:sales[0],access,receipt,productCode:products[0].code,
    fetchResource,now:new Date().toISOString(),
  });
  // The preview never calls a financial or lifecycle mutation.
  return json(decision,decision.decision==='retry'?503:200);
});
