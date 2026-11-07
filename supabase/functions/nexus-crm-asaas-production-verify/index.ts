import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { trustedAsaasToken } from '../_shared/crm-asaas-events.mjs';
import { previewProductionCrmAsaasPayment } from '../_shared/crm-asaas-production-review.mjs';

// Asaas monthly CRM PRODUCTION: independent read-only reconciliation.
// NEVER claim funds, create clients, invoices, subscriptions, access or email.
// HARD-OFF until the production webhook token and incoming events are approved.
const STAGED_PRODUCTION_VERIFY_DISABLED = true;
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{'content-type':'application/json; charset=utf-8',
   'cache-control':'no-store','x-content-type-options':'nosniff'},
});
const validId=(value:unknown,prefix:string)=>typeof value==='string'
 && new RegExp('^'+prefix+'_[A-Za-z0-9_-]{4,130}$').test(value);

async function readEventId(req:Request):Promise<string|null>{
 if(!(req.headers.get('content-type')||'').toLowerCase().startsWith('application/json')
   || Number(req.headers.get('content-length')||0)>512 || !req.body)return null;
 let size=0;const chunks:Uint8Array[]=[];
 try{
  const reader=req.body.getReader();
  while(true){
   const part=await reader.read();
   if(part.done)break;
   size+=part.value?.length||0;
   if(size>512)return null;
   if(part.value)chunks.push(part.value);
  }
  const combined=new Uint8Array(size);let at=0;
  for(const chunk of chunks){combined.set(chunk,at);at+=chunk.length;}
  const input:unknown=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(combined));
  if(!input||typeof input!=='object'||Array.isArray(input)
    ||Object.keys(input).length!==1
    ||typeof (input as Record<string,unknown>).eventId!=='string'
    ||!/^asaas:evt_[A-Za-z0-9_&.-]{6,150}$/.test(
      (input as Record<string,unknown>).eventId as string))return null;
  return (input as {eventId:string}).eventId;
 }catch{return null;}
}

Deno.serve(async(req:Request)=>{
 // Hard-off BEFORE even reading request or opening the database.
 if(STAGED_PRODUCTION_VERIFY_DISABLED) return reply({
  error:'Verificação mensal Asaas produção ainda em homologação.',
  readOnly:true,canActivateCrm:false,
 },503);
 if(req.method!=='POST')return reply({error:'Método não permitido.'},405);
 if(Deno.env.get('NEXUS_CRM_ASAAS_PROD_VERIFY_ENABLED')!=='true') {
  return reply({error:'Verificação de produção desativada.'},503);
 }
 const secret=Deno.env.get('NEXUS_CRM_ASAAS_PROD_VERIFY_SECRET')||'';
 if(secret===(Deno.env.get('NEXUS_CRM_ASAAS_PROD_EVENTS_TOKEN')||'')
   ||secret===(Deno.env.get('ASAAS_PRODUCTION_API_KEY')||'')
   ||!trustedAsaasToken(req.headers.get('x-nexus-crm-asaas-prod-verify-key'),secret)) {
  return reply({error:'Não autorizado.'},401);
 }
 const eventId=await readEventId(req);
 if(!eventId)return reply({error:'Evento inválido.'},400);
 const url=Deno.env.get('SUPABASE_URL')||'';
 const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 const asaasKey=Deno.env.get('ASAAS_PRODUCTION_API_KEY')||'';
 if(!url||service.length<30||!asaasKey.startsWith('$aact_prod_')||asaasKey.length<32) {
  return reply({error:'Consulta Asaas de produção não configurada.'},503);
 }
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:event,error:eventError}=await admin.from('nexus_crm_asaas_production_events')
  .select('provider_event_id,event_type,resource_id,payload,environment,processing_status')
  .eq('provider_event_id',eventId).eq('environment','production').maybeSingle();
 if(eventError)return reply({decision:'retry',reason:'event_unavailable',
   readOnly:true,canActivateCrm:false},503);
 if(!event || !['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(event.event_type)) {
  return reply({decision:'hold',reason:'no_settlement_event',
   readOnly:true,canActivateCrm:false},200);
 }
 const resource=event.payload?.resource;
 const linkId=resource?.paymentLink;
 const subId=resource?.subscription;
 const linkedByLink=typeof linkId==='string' && /^[A-Za-z0-9_-]{4,120}$/.test(linkId);
 const linkedBySub=validId(subId,'sub');
 if(!linkedByLink&&!linkedBySub)return reply({
   decision:'manual_review',reason:'provider_relationship_missing',
   readOnly:true,canActivateCrm:false,
 },200);
 let saleQuery=admin.from('nexus_sales').select('*')
  .eq('provider','asaas').eq('environment','production')
  .eq('billing_mode','recurring').eq('billing_cycle_months',1);
 saleQuery=linkedByLink?saleQuery.eq('asaas_checkout_id',linkId)
   :saleQuery.eq('asaas_subscription_id',subId);
 const {data:sales,error:salesError}=await saleQuery.limit(2);
 if(salesError)return reply({
   decision:'retry',reason:'sale_lookup_unavailable',
   readOnly:true,canActivateCrm:false,
 },503);
 if(!sales||sales.length!==1)return reply({
   decision:'manual_review',reason:'sale_not_unique',
   readOnly:true,canActivateCrm:false,
 },200);
 const sale=sales[0];
 const {data:product,error:productError}=await admin.from('nexus_products')
  .select('code').eq('id',sale.product_id).maybeSingle();
 if(productError||product?.code!=='crm')return reply({
   decision:'manual_review',reason:'not_crm_product',
   readOnly:true,canActivateCrm:false,
 },200);

 const fetchResource=async(path:string)=>{
  // No URL from webhook/browser can select the provider host or route.
  if(!/^\/(payments|paymentLinks|customers|subscriptions)\/[A-Za-z0-9_-]{4,130}$/.test(path))
    throw Error('provider_path_rejected');
  const response=await fetch('https://api.asaas.com/v3'+path,{
   method:'GET',headers:{accept:'application/json',access_token:asaasKey,
    'User-Agent':'NexusCRM-ProdMonthlyReadOnly/1.0'},
   signal:AbortSignal.timeout(8000),
  });
  if(!response.ok)throw Error('provider_lookup_failed');
  if(Number(response.headers.get('content-length')||0)>30000)
    throw Error('provider_result_too_large');
  const text=await response.text();
  if(text.length>30000)throw Error('provider_result_too_large');
  return JSON.parse(text);
 };
 const result=await previewProductionCrmAsaasPayment({
  eventRow:{...event,provider:'asaas'},
  sale,productCode:product.code,fetchResource,
 });
 return reply({
  decision:result.decision,
  reason:typeof result.reason==='string'?result.reason:null,
  readOnly:true,
  canActivateCrm:false,
  independentlyVerified:result.decision==='verified_for_review',
 },result.decision==='retry'?503:200);
});
