import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { trustedAsaasToken } from '../_shared/crm-asaas-events.mjs';
import { verifyCrmAsaasPayment } from '../_shared/crm-asaas-provider-verification.mjs';
import { reconcileCrmAsaasSettlement } from '../_shared/crm-asaas-settlement-pipeline.mjs';

// Private Sandbox verification and separately authorized payment reservation.
// Read-only by default. Only an explicit reserve request + independent server
// secret may reserve a *provider-verified* payment via a restricted SQL RPC.
// This endpoint cannot mark a sale paid, claim funds or provision CRM access.
// Never call it from a browser or Asaas webhook.
function json(body: unknown,status = 200) {
  return new Response(JSON.stringify(body), {status,headers:{
    'content-type':'application/json; charset=utf-8','cache-control':'no-store',
  }});
}
Deno.serve(async (req: Request): Promise<Response> => {
  // Read-only verification stays the default. A second independent key and
  // explicit flag are required before the reservation RPC may ever execute.
  // Claims and customer access remain impossible here.

  if (req.method !== 'POST') return json({error:'Método não permitido.'},405);
  if (Deno.env.get('NEXUS_CRM_ASAAS_VERIFY_ENABLED') !== 'true'
    || Deno.env.get('NEXUS_CRM_ASAAS_MONTHLY_MODE') !== 'sandbox') {
    return json({error:'Conciliação em testes desativada.'},503);
  }
  const secret = Deno.env.get('NEXUS_CRM_ASAAS_VERIFY_SECRET') || '';
  if (!trustedAsaasToken(req.headers.get('x-nexus-central-internal-key'),secret)) {
    return json({error:'Não autorizado.'},401);
  }
  if (!(req.headers.get('content-type')||'').startsWith('application/json')
    || Number(req.headers.get('content-length')||'0') > 2048) return json({error:'Requisição inválida.'},400);
  let raw: string;
  try {
    const reader = req.body?.getReader();
    if (!reader) return json({error:'Corpo ausente.'},400);
    let size=0; const bytes: Uint8Array[]=[];
    while(true){const part=await reader.read();if(part.done)break;
      size+=part.value?.length||0;if(size>2048)return json({error:'Requisição muito grande.'},413);
      if(part.value)bytes.push(part.value);
    }
    const combined=new Uint8Array(size); let at=0;
    for(const b of bytes){combined.set(b,at);at+=b.length;}
    raw=new TextDecoder('utf-8',{fatal:true}).decode(combined);
  } catch {return json({error:'Corpo inválido.'},400);}
  let payload: Record<string,unknown>;
  try {payload=JSON.parse(raw);} catch {return json({error:'JSON inválido.'},400);}
  if(!payload || typeof payload !== 'object' || Array.isArray(payload)
    || typeof payload.eventId !== 'string'
    || !/^asaas:evt_[A-Za-z0-9_&.-]{6,150}$/.test(payload.eventId)
    || (payload.reserve !== undefined && typeof payload.reserve !== 'boolean')
    || Object.keys(payload).some(k => !['eventId','reserve'].includes(k))) {
    return json({error:'Evento inválido.'},400);
  }

  const reservationRequested=payload.reserve===true;
  if(reservationRequested){
    // An exposed verifier token is never enough to write even a reservation.
    if(Deno.env.get('NEXUS_CRM_ASAAS_RESERVATION_ENABLED')!=='true') {
      return json({decision:'hold',reason:'reservation_disabled',canActivateCrm:false},403);
    }
    const reservationSecret=Deno.env.get('NEXUS_CRM_ASAAS_RESERVATION_SECRET')||'';
    if(reservationSecret===secret || !trustedAsaasToken(
      req.headers.get('x-nexus-asaas-reservation-key'),reservationSecret
    )){
      return json({error:'Reserva não autorizada.'},401);
    }
  }

  const url=Deno.env.get('SUPABASE_URL')||'';
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  const asaasKey=Deno.env.get('ASAAS_SANDBOX_API_KEY')||'';
  if(!url || key.length<30 || asaasKey.length<20) return json({error:'Ambiente de testes não configurado.'},503);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:eventRow,error:eventError}=await admin.from('nexus_payment_webhook_events')
    .select('provider_event_id,provider,event_type,resource_id,payload,processed_at')
    .eq('provider_event_id',payload.eventId).eq('provider','asaas').maybeSingle();
  if(eventError) return json({error:'Erro de leitura do evento.'},503);
  if(!eventRow) return json({error:'Evento não encontrado.'},404);
  if(!['PAYMENT_CONFIRMED','PAYMENT_RECEIVED'].includes(eventRow.event_type)) {
    return json({decision:'hold',reason:'not_settlement_event'});
  }
  const resource=eventRow.payload?.resource;
  const linkId=resource?.paymentLink;
  const subscriptionId=resource?.subscription;
  const validLinkId=typeof linkId==='string' && /^[A-Za-z0-9_-]{4,120}$/.test(linkId);
  const validSubId=typeof subscriptionId==='string' && /^sub_[A-Za-z0-9_-]{4,120}$/.test(subscriptionId);
  if(!validLinkId && !validSubId) return json({decision:'manual_review',reason:'provider_relationship_missing'});
  let query=admin.from('nexus_sales')
    .select('id,provider,environment,product_id,plan_id,sale_status,billing_mode,billing_cycle_months,checkout_amount_cents,asaas_checkout_id,asaas_subscription_id,registration_number')
    .eq('provider','asaas').eq('environment','sandbox');
  query=validLinkId?query.eq('asaas_checkout_id',linkId):query.eq('asaas_subscription_id',subscriptionId);
  const {data:sales,error:saleError}=await query.limit(2);
  if(saleError) return json({error:'Falha na consulta de vínculo.'},503);
  if(!sales || sales.length!==1) return json({decision:'manual_review',reason:'sale_not_uniquely_linked'});
  const sale=sales[0];
  const {data:product,error:productError}=await admin.from('nexus_products')
    .select('code').eq('id',sale.product_id).maybeSingle();
  if(productError || product?.code!=='crm') return json({decision:'manual_review',reason:'not_crm_product'});

  const fetchResource=async (path:string) => {
    // No caller-controlled base URL and no arbitrary path; ids supplied to this
    // function are checked by the pure verification helper.
    if(!/^\/(payments|paymentLinks|customers|subscriptions)\/[A-Za-z0-9_-]{4,130}$/.test(path)) {
      throw new Error('invalid_provider_path');
    }
    const response=await fetch('https://api-sandbox.asaas.com/v3'+path,{
      method:'GET',headers:{'accept':'application/json',
        'access_token':asaasKey,'User-Agent':'NexusCRM-SandboxReconciler/1.0'},
      signal:AbortSignal.timeout(8000),
    });
    if(!response.ok) throw new Error('provider_lookup_failure');
    const length=Number(response.headers.get('content-length')||'0');
    if(length>30000) throw new Error('provider_response_too_large');
    const body=await response.text();
    if(body.length>30000) throw new Error('provider_response_too_large');
    return JSON.parse(body);
  };
  const decision=await verifyCrmAsaasPayment({eventRow,sale,fetchResource});
  const result=await reconcileCrmAsaasSettlement({
    verification:decision,
    eventId:eventRow.provider_event_id,
    environment:'sandbox',
    // The read-only path calls no RPC at all. Reservation is available only
    // following the two private secret checks above and fresh Asaas API reads.
    reservationEnabled:reservationRequested,
    claimEnabled:false,
    callRpc:async(name:string,args:Record<string,unknown>)=>{
      if(!reservationRequested || name!=='reserve_nexus_crm_asaas_verified_payment'){
        throw new Error('forbidden_financial_rpc');
      }
      return admin.rpc('reserve_nexus_crm_asaas_verified_payment',args);
    },
  });
  // This endpoint NEVER creates an Auth user, tenant, invoice or entitlement.
  // A separate, independently authorized and audited worker is needed for
  // provisionSaleForProvider; do NOT trigger from untrusted webhook requests.
  return json(result,result.decision==='retry'?503:200);
});
