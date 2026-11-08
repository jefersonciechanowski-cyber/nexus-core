import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { trustedAsaasToken } from '../_shared/crm-asaas-events.mjs';
import { verifyProductionCrmAsaasAnnual } from '../_shared/crm-asaas-annual-verification.mjs';
import { provisionCrmAnnualAsaasSale } from '../_shared/crm-asaas-annual-sale-provisioning.ts';

// Financial worker for ONE verified Black Friday annual (prepaid) payment.
// Hard-off independently from monthly until all flags are explicitly approved.
// Provider GETs, atomic DB lease and one-time tenant provisioning are required.
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},
});
const clean=(value:unknown,max=500)=>String(value??'').trim().slice(0,max);
function slugify(value:unknown){
  return clean(value,120).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,48)||'empresa';
}
function addMonthsDate(months:number){
  const today=new Date();
  const y=today.getUTCFullYear(),m=today.getUTCMonth(),d=today.getUTCDate();
  const target=new Date(Date.UTC(y,m+months,1));
  const last=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
  target.setUTCDate(Math.min(d,last));
  return target.toISOString().slice(0,10);
}
async function readEventId(req:Request){
  if(!(req.headers.get('content-type')||'').startsWith('application/json')
    ||Number(req.headers.get('content-length')||0)>2048)return null;
  const text=await req.text();
  if(text.length>2048)return null;
  try{
    const json=JSON.parse(text);
    return json && typeof json==='object' && !Array.isArray(json)
      &&typeof json.eventId==='string'
      &&/^asaas:evt_[A-Za-z0-9_&.-]{6,150}$/.test(json.eventId)
      ?json.eventId:null;
  }catch{return null;}
}
Deno.serve(async(request:Request):Promise<Response>=>{
  if(Deno.env.get('NEXUS_CRM_ASAAS_PROD_ANNUAL_RELEASE_APPROVED')!=='true'
    ||Deno.env.get('NEXUS_CRM_ASAAS_PROD_ANNUAL_SETTLEMENT_READY')!=='true'
    ||Deno.env.get('NEXUS_CRM_ASAAS_PROD_ANNUAL_WORKER_READY')!=='true'
    ||Deno.env.get('NEXUS_CRM_ASAAS_PROD_RELEASE_APPROVED')!=='true'
    ||Deno.env.get('NEXUS_CRM_ASAAS_PROD_WEBHOOK_CONFIRMED')!=='true')
    return reply({error:'Provisionamento anual em homologação.'},503);
  if(request.method!=='POST')return reply({error:'Método não permitido.'},405);
  const workerSecret=Deno.env.get('NEXUS_CRM_ASAAS_PROD_WORKER_SECRET')||'';
  if(workerSecret===(Deno.env.get('ASAAS_PRODUCTION_API_KEY')||'')
    ||workerSecret===(Deno.env.get('NEXUS_CRM_ASAAS_PROD_EVENTS_TOKEN')||'')
    ||!trustedAsaasToken(request.headers.get('x-nexus-crm-annual-key'),workerSecret))
      return reply({error:'Não autorizado.'},401);
  const eventId=await readEventId(request);
  if(!eventId)return reply({error:'Evento inválido.'},400);
  const url=Deno.env.get('SUPABASE_URL')||'';
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  const apiKey=Deno.env.get('ASAAS_PRODUCTION_API_KEY')||'';
  if(!url || serviceKey.length<30 || !apiKey.startsWith('$aact_prod_'))
    return reply({error:'Asaas Produção não configurado.'},503);
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:event,error:eventError}=await admin.from('nexus_crm_asaas_production_events')
    .select('provider_event_id,event_type,resource_id,payload,environment,provider,processing_status')
    .eq('provider_event_id',eventId).eq('environment','production').eq('processing_status','pending').maybeSingle();
  if(eventError)return reply({decision:'retry',reason:'event_unavailable'},503);
  if(!event || !['PAYMENT_CONFIRMED','PAYMENT_RECEIVED'].includes(event.event_type))
    return reply({decision:'manual_review',reason:'not_a_settlement_event'},409);
  const link=event.payload?.resource?.paymentLink;
  if(typeof link!=='string'||!/^[A-Za-z0-9_-]{4,120}$/.test(link))
    return reply({decision:'manual_review',reason:'missing_annual_payment_link'},409);
  const {data:sales,error:salesError}=await admin.from('nexus_sales').select('*')
    .eq('asaas_checkout_id',link).eq('provider','asaas').eq('environment','production').limit(2);
  if(salesError)return reply({decision:'retry',reason:'sale_read_failed'},503);
  if(!sales || sales.length!==1)return reply({decision:'manual_review',reason:'sale_not_unique'},409);
  const sale=sales[0];
  const {data:plan,error:planError}=await admin.from('nexus_plans')
    .select('id,product_id,code,name,price_cents,currency,billing_interval_months,status,public_visible')
    .eq('id',sale.plan_id).maybeSingle();
  if(planError||!plan)return reply({decision:'retry',reason:'plan_read_failed'},503);
  const {data:product,error:productError}=await admin.from('nexus_products')
    .select('code').eq('id',plan.product_id).maybeSingle();
  if(productError||product?.code!=='crm'||plan.product_id!==sale.product_id)
    return reply({decision:'manual_review',reason:'not_crm_product'},409);
  const fetchResource=async(path:string)=>{
    if(!/^\/(payments|paymentLinks|customers)\/[A-Za-z0-9_-]{4,130}$/.test(path))
      throw Error('unsafe_provider_path');
    const upstream=await fetch('https://api.asaas.com/v3'+path,{
      headers:{'accept':'application/json','access_token':apiKey,'User-Agent':'NexusCRM-AnnualSettlement/1.0'},
      signal:AbortSignal.timeout(9000),
    });
    if(!upstream.ok)throw Error('provider_get_failed');
    const text=await upstream.text();
    if(text.length>30000)throw Error('provider_response_too_large');
    return JSON.parse(text);
  };
  const verified=await verifyProductionCrmAsaasAnnual({eventRow:event,sale,plan,fetchResource});
  if(verified.decision!=='verified_for_settlement')
    return reply({decision:verified.decision,reason:verified.reason,canActivateCrm:false},
      verified.decision==='retry'?503:409);
  const {data:reserved,error:reserveError}=await admin.rpc(
    'reserve_nexus_crm_asaas_production_annual_settlement',{
      p_sale_id:verified.saleId,p_provider_event_id:eventId,p_payment_id:verified.paymentId,
      p_customer_id:verified.customerId,p_amount_cents:verified.amountCents,
      p_billing_type:verified.billingType,
    });
  if(reserveError)return reply({decision:'retry',reason:'annual_reservation_unavailable'},503);
  if(reserved?.decision!=='provision_ready')
    return reply({decision:'manual_review',reason:reserved?.reason||'annual_claim_unavailable'},409);
  const {data:lease,error:leaseError}=await admin.rpc(
    'begin_nexus_crm_asaas_production_annual_provisioning',{
      p_sale_id:verified.saleId,p_payment_id:verified.paymentId,
    });
  if(leaseError)return reply({decision:'retry',reason:'annual_lease_unavailable'},503);
  if(lease?.decision!=='acquired')
    return reply({decision:'manual_review',reason:lease?.reason||'annual_lease_denied'},409);
  const {data:paidSale,error:paidError}=await admin.from('nexus_sales')
    .select('*').eq('id',verified.saleId).eq('sale_status','paid')
    .eq('provider','asaas').eq('environment','production').maybeSingle();
  if(paidError||!paidSale||paidSale.asaas_subscription_id!=null)
    return reply({decision:'manual_review',reason:'annual_sale_changed_after_claim'},409);
  try{
    const result=await provisionCrmAnnualAsaasSale(admin,paidSale,{
      customerId:verified.customerId,subscriptionId:null,paymentId:verified.paymentId,
      paymentBillingType:verified.billingType,paymentStatus:verified.paymentStatus,
      eventType:event.event_type,
    },{
      provider:'asaas',asaasEnvironment:'production',clean,slugify,addMonthsDate,
      sendFirstAccessEmail:async()=>{throw Error('non_crm_product_forbidden');},
      sendPilotConversionEmail:async()=>{throw Error('pilot_conversion_forbidden');},
    });
    if(result.error||!result.access?.id)return reply({
      decision:'manual_review',reason:'annual_provision_requires_review'},409);
    const {data:completed,error:completedError}=await admin.rpc(
      'complete_nexus_crm_asaas_production_annual_provisioning',{
        p_sale_id:verified.saleId,p_payment_id:verified.paymentId,
      });
    if(completedError||completed?.decision!=='completed')
      return reply({decision:'manual_review',reason:'annual_completion_requires_review'},409);
    return reply({decision:'provisioned',saleId:verified.saleId});
  }catch{return reply({decision:'manual_review',reason:'annual_partial_provision_requires_review'},409);}
});
