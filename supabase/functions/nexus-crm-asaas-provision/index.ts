import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { trustedAsaasToken } from '../_shared/crm-asaas-events.mjs';
import { verifyCrmAsaasPayment } from '../_shared/crm-asaas-provider-verification.mjs';
import { reconcileCrmAsaasSettlement } from '../_shared/crm-asaas-settlement-pipeline.mjs';
import { provisionSaleForProvider } from '../_shared/nexus-sale-provisioning.ts';

// Internal, default-OFF, sandbox-only activation worker.
// A successful Asaas webhook is NOT sufficient: fresh provider GETs, atomic
// financial claim, and a one-time DB provisioning lease are all REQUIRED.
// NEVER invoked automatically by the public checkout or webhook inbox.
const reply=(value:unknown,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},
});
const clean=(value:unknown,size=500)=>String(value??'').trim().slice(0,size);
function slugify(value:unknown){
  return clean(value,120).normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')
    .slice(0,48)||'empresa';
}
function addMonthsDate(months:number){
  const date=new Date();
  date.setUTCMonth(date.getUTCMonth()+Math.max(1,Number(months)||1));
  return date.toISOString().slice(0,10);
}
async function readEventId(req:Request){
  if(!(req.headers.get('content-type')||'').startsWith('application/json')
    || Number(req.headers.get('content-length')||'0')>2048 || !req.body) return null;
  let length=0;const bytes:Uint8Array[]=[];
  try{
    const reader=req.body.getReader();
    while(true){
      const part=await reader.read();
      if(part.done)break;
      length+=part.value?.length||0;
      if(length>2048)return null;
      if(part.value)bytes.push(part.value);
    }
    const combined=new Uint8Array(length);let i=0;
    for(const b of bytes){combined.set(b,i);i+=b.length;}
    const parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(combined));
    if(!parsed || typeof parsed!=='object' || Array.isArray(parsed)
      || typeof parsed.eventId!=='string'
      || !/^asaas:evt_[A-Za-z0-9_&.-]{6,150}$/.test(parsed.eventId))return null;
    return parsed.eventId;
  }catch{return null;}
}
Deno.serve(async(req:Request):Promise<Response>=>{
  // HARD-OFF: never call provider, DB or provisioner until separately approved.
  const STAGED_ASAAS_DISABLED = true;
  if (STAGED_ASAAS_DISABLED) return reply({ error: 'Provisionamento Asaas desativado.' }, 503);

  if(req.method!=='POST')return reply({error:'Método não permitido.'},405);
  // Independent kill switches. All must be explicitly enabled by an operator
  // AFTER SQL migrations and Asaas Sandbox E2E verification, never by default.
  if(Deno.env.get('NEXUS_CRM_ASAAS_PROVISION_ENABLED')!=='true'
    || Deno.env.get('NEXUS_CRM_ASAAS_VERIFY_ENABLED')!=='true'
    || Deno.env.get('NEXUS_CRM_ASAAS_RESERVATION_ENABLED')!=='true'
    || Deno.env.get('NEXUS_CRM_ASAAS_CLAIM_ENABLED')!=='true'
    || Deno.env.get('NEXUS_CRM_ASAAS_MONTHLY_MODE')!=='sandbox'){
    return reply({error:'Provisionamento do CRM em testes desativado.'},503);
  }
  const secret=Deno.env.get('NEXUS_CRM_ASAAS_VERIFY_SECRET')||'';
  if(!trustedAsaasToken(req.headers.get('x-nexus-central-internal-key'),secret)){
    return reply({error:'Não autorizado.'},401);
  }
  const eventId=await readEventId(req);
  if(!eventId)return reply({error:'Evento inválido.'},400);
  const url=Deno.env.get('SUPABASE_URL')||'';
  const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  const asaasKey=Deno.env.get('ASAAS_SANDBOX_API_KEY')||'';
  if(!url||serviceKey.length<30||asaasKey.length<20)return reply({error:'Sandbox não configurado.'},503);
  const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:event,error:eventError}=await admin.from('nexus_payment_webhook_events')
    .select('provider_event_id,provider,event_type,resource_id,payload')
    .eq('provider_event_id',eventId).eq('provider','asaas').maybeSingle();
  if(eventError)return reply({decision:'retry',reason:'event_read_failed',canActivateCrm:false},503);
  if(!event || !['PAYMENT_CONFIRMED','PAYMENT_RECEIVED'].includes(event.event_type)){
    return reply({decision:'manual_review',reason:'not_settlement_event',canActivateCrm:false},409);
  }
  const linkId=event.payload?.resource?.paymentLink;
  if(typeof linkId!=='string'||!/^[A-Za-z0-9_-]{4,120}$/.test(linkId)){
    return reply({decision:'manual_review',reason:'payment_link_missing',canActivateCrm:false},409);
  }
  const {data:sales,error:salesError}=await admin.from('nexus_sales')
    .select('*').eq('provider','asaas').eq('environment','sandbox')
    .eq('asaas_checkout_id',linkId).limit(2);
  if(salesError||!sales||sales.length!==1){
    return reply({decision:'manual_review',reason:'sale_not_unique',canActivateCrm:false},409);
  }
  const sale=sales[0];
  const {data:product,error:productError}=await admin.from('nexus_products')
    .select('code').eq('id',sale.product_id).maybeSingle();
  if(productError||product?.code!=='crm'){
    return reply({decision:'manual_review',reason:'not_crm_product',canActivateCrm:false},409);
  }
  const fetchResource=async(path:string)=>{
    if(!/^\/(payments|paymentLinks|customers|subscriptions)\/[A-Za-z0-9_-]{4,130}$/.test(path)){
      throw Error('bad_provider_path');
    }
    const response=await fetch('https://api-sandbox.asaas.com/v3'+path,{
      headers:{accept:'application/json',access_token:asaasKey,
        'User-Agent':'NexusCRM-VerifiedProvisioner/1.0'},
      signal:AbortSignal.timeout(8000),
    });
    if(!response.ok)throw Error('provider_read_failed');
    const body=await response.text();
    if(body.length>30000)throw Error('provider_response_too_large');
    return JSON.parse(body);
  };
  const verified=await verifyCrmAsaasPayment({eventRow:event,sale,fetchResource});
  if(verified.decision!=='verified_for_review'
    || verified.paymentStatus!=='RECEIVED' && verified.paymentStatus!=='CONFIRMED'
    || verified.subscriptionStatus!=='ACTIVE'){
    return reply({decision:verified.decision==='retry'?'retry':'manual_review',
      reason:'payment_or_subscription_not_active',canActivateCrm:false},
      verified.decision==='retry'?503:409);
  }
  const settled=await reconcileCrmAsaasSettlement({
    verification:verified,eventId,environment:'sandbox',
    reservationEnabled:true,claimEnabled:true,
    callRpc:async(name:string,args:Record<string,unknown>)=>{
      if(!['reserve_nexus_crm_asaas_verified_payment',
        'claim_nexus_crm_asaas_provisioning'].includes(name))throw Error('invalid_rpc');
      return admin.rpc(name,args);
    },
  });
  if(settled.decision!=='ready_for_provisioning'){
    return reply({...settled,canActivateCrm:false},settled.decision==='retry'?503:409);
  }
  // Lock the right to provision exactly ONCE. A crashed worker leaves the
  // lease for human review; it cannot create duplicate users on retries.
  const {data:lease,error:leaseError}=await admin.rpc('begin_nexus_crm_asaas_provisioning',{
    p_sale_id:verified.saleId,p_payment_id:verified.paymentId,
  });
  if(leaseError)return reply({decision:'retry',reason:'lease_unavailable',canActivateCrm:false},503);
  if(lease?.decision!=='acquired'){
    return reply({decision:lease?.decision||'manual_review',
      reason:lease?.reason||'provisioning_already_started',
      canActivateCrm:false},409);
  }
  const {data:paidSale,error:paidSaleError}=await admin.from('nexus_sales')
    .select('*').eq('id',verified.saleId).eq('provider','asaas')
    .eq('environment','sandbox').maybeSingle();
  if(paidSaleError||paidSale?.sale_status!=='paid'||!paidSale.paid_at
    ||paidSale.asaas_subscription_id!==verified.subscriptionId){
    return reply({decision:'manual_review',reason:'sale_changed_after_claim',canActivateCrm:false},409);
  }
  try{
    const provision=await provisionSaleForProvider(admin,paidSale,{
      customerId:verified.providerCustomerId,
      subscriptionId:verified.subscriptionId,
      paymentId:verified.paymentId,
      paymentBillingType:verified.billingType,
      paymentStatus:verified.paymentStatus,
      eventType:event.event_type,
    },{
      provider:'asaas',clean,slugify,addMonthsDate,
      sendFirstAccessEmail:async()=>{throw Error('non_crm_product_forbidden');},
      sendPilotConversionEmail:async()=>{throw Error('pilot_conversion_forbidden');},
    });
    if(provision.error || !provision.access?.id){
      return reply({decision:'manual_review',
        reason:'provisioning_incomplete_manual_intervention',canActivateCrm:false},409);
    }
    const {data:complete,error:completeError}=await admin.rpc(
      'complete_nexus_crm_asaas_provisioning',{
        p_sale_id:verified.saleId,p_payment_id:verified.paymentId,
      });
    if(completeError||complete?.decision!=='completed'){
      // Must NOT retry new-user creation: CRM account may already be live.
      return reply({decision:'manual_review',
        reason:'provisioning_confirmation_incomplete',canActivateCrm:false},409);
    }
    return reply({decision:'provisioned',saleId:verified.saleId});
  }catch{
    // No automatic replay after lease acquisition.
    return reply({decision:'manual_review',
      reason:'partial_provisioning_requires_manual_review',canActivateCrm:false},409);
  }
});
