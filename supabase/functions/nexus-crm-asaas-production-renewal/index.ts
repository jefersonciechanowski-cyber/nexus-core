import {createClient} from 'npm:@supabase/supabase-js@2.112.3';
import {trustedAsaasToken} from '../_shared/crm-asaas-events.mjs';
import {previewProductionCrmAsaasRenewal} from '../_shared/crm-asaas-production-renewal-review.mjs';
import {syncCrmEntitlement} from '../stripe-webhook/crm-provisioning.ts';

// Separate PRODUCTION-only renewal worker. Never creates an Asaas charge or
// user. HARD OFF until webhook delivery, policy and CRM sync are approved.
// The internal caller must supply an event ID from the authenticated inbox.
const STAGED_ASAAS_PRODUCTION_RENEWAL_DISABLED = Deno.env.get('NEXUS_CRM_ASAAS_PROD_RELEASE_APPROVED') !== 'true';
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{'content-type':'application/json; charset=utf-8',
  'cache-control':'no-store','x-content-type-options':'nosniff'},
});
async function eventId(req:Request){
 if(!(req.headers.get('content-type')||'').toLowerCase().startsWith('application/json')
   ||Number(req.headers.get('content-length')||0)>512 || !req.body)return null;
 let size=0;const chunks:Uint8Array[]=[];
 try{
  const reader=req.body.getReader();
  while(true){const part=await reader.read();if(part.done)break;
   size+=part.value?.length||0;if(size>512)return null;
   if(part.value)chunks.push(part.value);
  }
  const bytes=new Uint8Array(size);let at=0;
  for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}
  const item=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!item||typeof item!=='object'||Array.isArray(item)
    ||Object.keys(item).length!==1||typeof item.eventId!=='string'
    ||!/^asaas:evt_[A-Za-z0-9_&.-]{6,150}$/.test(item.eventId))return null;
  return item.eventId as string;
 }catch{return null;}
}
Deno.serve(async(req:Request)=>{
 // Guard BEFORE reading input, opening any DB connection or calling Asaas.
 if(STAGED_ASAAS_PRODUCTION_RENEWAL_DISABLED)
  return reply({error:'Renovação mensal CRM Asaas produção em homologação.'},503);
 if(req.method!=='POST')return reply({error:'Método não permitido.'},405);
 if(Deno.env.get('NEXUS_CRM_ASAAS_PROD_RENEWAL_ENABLED')!=='true'
   ||Deno.env.get('NEXUS_CRM_ASAAS_PROD_SETTLEMENT_READY')!=='true'
   ||Deno.env.get('NEXUS_CRM_ASAAS_PROD_WEBHOOK_CONFIRMED')!=='true')
   return reply({error:'Renovação mensal ainda não liberada.'},503);
 const secret=Deno.env.get('NEXUS_CRM_ASAAS_PROD_RENEWAL_SECRET')||'';
 const apiKey=Deno.env.get('ASAAS_PRODUCTION_API_KEY')||'';
 if(secret===apiKey || secret===(Deno.env.get('NEXUS_CRM_ASAAS_PROD_EVENTS_TOKEN')||'')
   || secret===(Deno.env.get('NEXUS_CRM_ASAAS_PROD_WORKER_SECRET')||'')
   || !trustedAsaasToken(req.headers.get('x-nexus-crm-renewal-key'),secret))
   return reply({error:'Não autorizado.'},401);
 const target=await eventId(req);
 if(!target)return reply({error:'Evento inválido.'},400);
 const url=Deno.env.get('SUPABASE_URL')||'';
 const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 if(!url || service.length<30 || !apiKey.startsWith('$aact_prod_') || apiKey.length<32)
  return reply({error:'Ambiente mensal não configurado.'},503);
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:evt,error:evtError}=await admin.from('nexus_crm_asaas_production_events')
  .select('provider_event_id,event_type,resource_id,payload,environment')
  .eq('provider_event_id',target).eq('environment','production').maybeSingle();
 if(evtError)return reply({decision:'retry',reason:'event_db_unavailable'},503);
 if(!evt || !['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(evt.event_type))
  return reply({decision:'manual_review',reason:'not_paid_renewal_event'},409);
 const subscriptionId=evt.payload?.resource?.subscription;
 if(typeof subscriptionId!=='string'||!/^sub_[A-Za-z0-9_-]{5,120}$/.test(subscriptionId))
  return reply({decision:'manual_review',reason:'subscription_not_linked'},409);
 const {data:sales,error:salesError}=await admin.from('nexus_sales').select('*')
  .eq('provider','asaas').eq('environment','production').eq('sale_status','provisioned')
  .eq('asaas_subscription_id',subscriptionId).limit(2);
 if(salesError||!sales||sales.length!==1)
  return reply({decision:'manual_review',reason:'sale_not_unique'},409);
 const sale=sales[0];
 const {data:accesses,error:accessError}=await admin.from('organization_product_access')
  .select('id,organization_id,product_id,external_tenant_id,billing_provider,billing_mode,billing_cycle_months,commercial_condition,subscription_status,access_status,provider_customer_id,provider_subscription_id,contracted_price_cents')
  .eq('organization_id',sale.organization_id).eq('product_id',sale.product_id)
  .eq('provider_subscription_id',subscriptionId).limit(2);
 if(accessError||!accesses||accesses.length!==1)
  return reply({decision:'manual_review',reason:'access_not_unique'},409);
 const access=accesses[0];
 const {data:product,error:productError}=await admin.from('nexus_products')
  .select('code').eq('id',sale.product_id).maybeSingle();
 if(productError||product?.code!=='crm')
  return reply({decision:'manual_review',reason:'not_crm_product'},409);
 let upgradeReceipt=null;
 if(sale.source==='crm-trial-upgrade'){
  const {data,error}=await admin.from('nexus_crm_trial_upgrade_receipts').select('sale_id,access_id,tenant_id,state').eq('sale_id',sale.id).single();
  if(error||data?.state!=='completed')return reply({decision:'retry',reason:'upgrade_activation_pending'},503);
  upgradeReceipt=data;
 }
 const fetchResource=async(path:string)=>{
  if(!/^\/(payments|paymentLinks|subscriptions|customers)\/[A-Za-z0-9_-]{4,130}$/.test(path))
   throw Error('invalid_provider_path');
  const res=await fetch('https://api.asaas.com/v3'+path,{
   method:'GET',headers:{accept:'application/json',access_token:apiKey,
    'User-Agent':'NexusCRM-RecurringProductionRenewal/1.0'},
   signal:AbortSignal.timeout(8000),
  });
  if(!res.ok||Number(res.headers.get('content-length')||0)>30000)
   throw Error('provider_fetch_failed');
  const body=await res.text();
  if(body.length>30000)throw Error('provider_response_too_large');
  return JSON.parse(body);
 };
 const verified=await previewProductionCrmAsaasRenewal({
  eventRow:{...evt,provider:'asaas'},sale,access,productCode:product.code,fetchResource,upgradeReceipt,
 });
 if(verified.decision!=='verified_renewal_for_review' || !('accessId' in verified))
  return reply({decision:verified.decision,reason:('reason' in verified ? verified.reason : 'not_verified')},
   verified.decision==='retry'?503:409);
 // Atomic, one-invoice-per-cycle ledger. SQL checks event, exact company,
 // amount, previous cycles and terminal cancellation under row lock.
 const {data:recorded,error:recordError}=await admin.rpc(
  'record_nexus_crm_asaas_production_renewal',{
   p_sale_id:verified.saleId,p_access_id:verified.accessId,
   p_provider_event_id:verified.eventId,p_provider_payment_id:verified.paymentId,
   p_provider_customer_id:verified.customerId,p_amount_cents:verified.amountCents,
   p_billing_type:verified.billingType,p_provider_status:verified.paymentStatus,
   p_due_date:verified.dueDate,p_next_due_date:verified.nextDueDate,
  });
 if(recordError)return reply({decision:'retry',reason:'renewal_rpc_unavailable'},503);
 if(!['renewal_recorded','already_recorded'].includes(recorded?.decision))
  return reply({decision:'manual_review',reason:recorded?.reason||'receipt_not_confirmed'},409);
 // The CRM receives the EXISTING entitlement revision, not another account.
 // Failure leaves a recoverable delivery pending in the Central's outbox.
 const sync=await syncCrmEntitlement(
  admin,verified.accessId,undefined,new Date().toISOString(),
  recorded.decision==='renewal_recorded');
 if(!sync.synced)return reply({decision:'pending_crm_sync',reason:'remote_sync_unconfirmed'},503);
 await admin.from('nexus_crm_asaas_production_events').update({
  processing_status:'processed',processed_at:new Date().toISOString(),reason_code:null,
 }).eq('provider_event_id',verified.eventId).eq('environment','production')
 .eq('processing_status','pending');
 return reply({decision:'renewal_confirmed',crmSynced:true,alreadyRecorded:recorded.decision==='already_recorded'});
});

