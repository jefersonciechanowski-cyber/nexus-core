import {createClient} from 'npm:@supabase/supabase-js@2.112.3';
import {createRemoteJWKSet,jwtVerify} from 'npm:jose@6.1.0';
import {planCrmAsaasProductionDispatch} from '../_shared/crm-asaas-production-dispatch-plan.mjs';
import {assessCrmAsaasProductionWebhook} from '../_shared/crm-asaas-webhook-readiness.mjs';

// The authenticated Asaas webhook only persists events; this separate
// scheduled workflow can inspect them without access to billing credentials.
// FINANCIAL EXECUTION IS HARD-OFF until a genuine provider delivery and a
// complete settlement/provisioning E2E are independently approved.
const PRODUCTION_FINANCIAL_DISPATCH_DISABLED = Deno.env.get('NEXUS_CRM_ASAAS_PROD_RELEASE_APPROVED') !== 'true';
const REPO='jefersonciechanowski-cyber/nexus-core';
const WORKFLOW=REPO+'/.github/workflows/crm-asaas-production-dispatch.yml@refs/heads/main';
const AUDIENCE='nexus-crm-asaas-production-dispatch';
const MAX_EVENTS=3;
const ALLOWED_SUCCESS={
  provision:'provisioned',
  annual:'provisioned',
  renewal:'renewal_confirmed',
} as const;
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
  status,headers:{'content-type':'application/json; charset=utf-8',
    'cache-control':'no-store','x-content-type-options':'nosniff'},
});
const providerId=(value:unknown,prefix:string)=>
  typeof value==='string' &&
  new RegExp('^'+prefix+'_[A-Za-z0-9_-]{5,120}$').test(value);
const paymentLink=(value:unknown)=>
  typeof value==='string' && /^[A-Za-z0-9_-]{4,120}$/.test(value);
type EventRow={
  provider_event_id:string;event_type:string;resource_id:string;
  payload:Record<string,any>;environment:string;processing_status:string;
};

async function authorizedGithubJob(request:Request) {
  const token=(request.headers.get('authorization')||'')
    .replace(/^Bearer\s+/i,'').trim();
  if(!token || token.length>10000 || token.split('.').length!==3)return false;
  try{
    const jwks=createRemoteJWKSet(new URL(
      'https://token.actions.githubusercontent.com/.well-known/jwks'));
    const {payload}=await jwtVerify(token,jwks,{
      issuer:'https://token.actions.githubusercontent.com',audience:AUDIENCE,
    });
    const scoped=payload.repository===REPO
      &&payload.ref==='refs/heads/main'
      &&payload.workflow_ref===WORKFLOW
      &&['schedule','workflow_dispatch','push'].includes(String(payload.event_name||''))
      &&payload.ref_type==='branch';
    return scoped ? String(payload.event_name) : null;
  }catch{return null;}
}
async function readAction(request:Request) {
  if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')
    ||Number(request.headers.get('content-length')||0)>128||!request.body)return null;
  let raw='';
  try{
    raw=await request.text();
    if(new TextEncoder().encode(raw).length>128)return null;
    const body:unknown=JSON.parse(raw);
    if(!body||typeof body!=='object'||Array.isArray(body)
      ||Object.keys(body).length!==1)return null;
    const action=(body as Record<string,unknown>).action;
    return ['inspect','dispatch','readiness'].includes(String(action)) ? action : null;
  }catch{return null;}
}
async function backlog(admin:any) {
  const {count:pending,error:p}=await admin.from('nexus_crm_asaas_production_events')
    .select('provider_event_id',{count:'exact',head:true})
    .eq('environment','production').eq('processing_status','pending');
  const {count:manual,error:m}=await admin.from('nexus_crm_asaas_production_events')
    .select('provider_event_id',{count:'exact',head:true})
    .eq('environment','production').eq('processing_status','manual_review');
  if(p||m)return null;
  return {pending:Number(pending??0),manualReview:Number(manual??0)};
}
async function findSales(admin:any,event:EventRow){
  const resource=event.payload?.resource;
  const link=resource?.paymentLink;
  const sub=resource?.subscription;
  if(!paymentLink(link)&&!providerId(sub,'sub'))return [];
  const selected='id,product_id,provider,environment,billing_mode,billing_cycle_months,sale_status,asaas_checkout_id,asaas_subscription_id,paid_at';
  const found=new Map<string,any>();
  if(paymentLink(link)){
    const {data,error}=await admin.from('nexus_sales').select(selected)
      .eq('provider','asaas').eq('environment','production')
      .eq('asaas_checkout_id',link).limit(2);
    if(error)throw Error('sale_lookup_failed');
    for(const item of data||[])found.set(item.id,item);
  }
  if(providerId(sub,'sub')){
    const {data,error}=await admin.from('nexus_sales').select(selected)
      .eq('provider','asaas').eq('environment','production')
      .eq('asaas_subscription_id',sub).limit(2);
    if(error)throw Error('sale_lookup_failed');
    for(const item of data||[])found.set(item.id,item);
  }
  return Array.from(found.values()).slice(0,3);
}
async function markEvent(admin:any,eventId:string,status:'processed'|'manual_review',reason:string|null){
  const {data,error}=await admin.from('nexus_crm_asaas_production_events')
    .update({processing_status:status,reason_code:reason,
      processed_at:status==='processed'?new Date().toISOString():null})
    .eq('provider_event_id',eventId).eq('environment','production')
    .eq('processing_status','pending').select('provider_event_id');
  if(error)throw Error('event_state_update_failed');
  return (data||[]).length===1;
}
async function callIndependentWorker(base:string,worker:'provision'|'renewal'|'annual',eventId:string){
  const envName=worker==='renewal'
    ?'NEXUS_CRM_ASAAS_PROD_RENEWAL_SECRET'
    :'NEXUS_CRM_ASAAS_PROD_WORKER_SECRET';
  const key=Deno.env.get(envName)||'';
  const asaasKey=Deno.env.get('ASAAS_PRODUCTION_API_KEY')||'';
  const webhookKey=Deno.env.get('NEXUS_CRM_ASAAS_PROD_EVENTS_TOKEN')||'';
  if(key.length<32||key===asaasKey||key===webhookKey){
    return {status:'worker_not_configured',decision:'retry'};
  }
  const slug=worker==='renewal' ?'nexus-crm-asaas-production-renewal'
    :worker==='annual' ?'nexus-crm-asaas-production-annual-provision'
    :'nexus-crm-asaas-production-provision';
  const name=worker==='renewal'?'x-nexus-crm-renewal-key'
    :worker==='annual'?'x-nexus-crm-annual-key'
    :'x-nexus-central-internal-key';
  try{
    const response=await fetch(new URL('/functions/v1/'+slug,base),{
      method:'POST',headers:{
        'content-type':'application/json',
        [name]:key,
      },
      body:JSON.stringify({eventId}),
      signal:AbortSignal.timeout(45000),
    });
    if(Number(response.headers.get('content-length')||0)>4096)
      return {status:'worker_response_too_large',decision:'retry'};
    const text=await response.text();
    if(text.length>4096)return {status:'worker_response_too_large',decision:'retry'};
    let body:any;
    try{body=JSON.parse(text);}catch{return {status:'worker_bad_response',decision:'retry'};}
    if(response.status===200 && body?.decision===ALLOWED_SUCCESS[worker]
      &&(worker!=='renewal'||body.crmSynced===true)) {
      return {status:'accepted',decision:'processed'};
    }
    if(response.status===409)return {status:'operator_review',decision:'manual_review'};
    return {status:'worker_unavailable',decision:'retry'};
  }catch{return {status:'worker_network_failure',decision:'retry'};}
}


// Read-only first-customer readiness report for authorized GitHub OIDC runs.
// Returns names of missing switches, never values, identity or provider payloads.

// Separate, read-only HMAC parity test. The CRM signs one fixed, domain-separated
// message that can NEVER equal the checkout HMAC input timestamp + "." + body.
// Returns a status only, not keys, proofs, identities or financial records.
async function crmAsaasBridgeProofStatus():Promise<string>{
  const secret=Deno.env.get('NEXUS_CRM_ASAAS_PROD_CHECKOUT_BRIDGE_SECRET')||'';
  if(secret.length<32)return 'not_configured';
  try{
    const response=await fetch('https://crm.nexuscore.app.br/api/internal/crm-asaas-bridge-proof',{
      method:'GET',redirect:'error',
      headers:{accept:'application/json','x-nexus-readiness-probe':'crm-asaas-bridge-v1'},
      signal:AbortSignal.timeout(6000),
    });
    if(!response.ok || Number(response.headers.get('content-length')||0)>512)
      return 'unavailable';
    const body=await response.text();
    if(body.length>512)return 'invalid_response';
    const parsed=JSON.parse(body);
    if(parsed?.status!=='read_only_bridge_proof' 
      || typeof parsed.proof!=='string' || !/^[a-f0-9]{64}$/.test(parsed.proof))
      return 'invalid_response';
    const encoder=new TextEncoder();
    const key=await crypto.subtle.importKey('raw',encoder.encode(secret),
      {name:'HMAC',hash:'SHA-256'},false,['sign']);
    const digest=await crypto.subtle.sign('HMAC',key,
      encoder.encode('NEXUS_CRM_ASAAS_READONLY_BRIDGE_KEY_PROOF_V1'));
    const expected=Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
    let difference=0;
    for(let i=0;i<expected.length;i++)
      difference|=expected.charCodeAt(i)^parsed.proof.charCodeAt(i);
    return difference===0?'matched':'mismatch';
  }catch{return 'unavailable';}
}


// Authenticated receiver health check: read-only GET using the existing private
// webhook token. This proves endpoint auth and DB inbox access, NOT that Asaas
// itself delivered an event or that any payment was received.
async function checkInternalWebhookReceiver():Promise<string>{
  const token=Deno.env.get('NEXUS_CRM_ASAAS_PROD_EVENTS_TOKEN')||'';
  if(token.length<32 || token.length>255 || /\s/.test(token))return 'not_configured';
  try{
    const response=await fetch(
      'https://svphwbccqeoakpmcpvhy.supabase.co/functions/v1/nexus-crm-asaas-production-events',{
        method:'GET',redirect:'error',
        headers:{
          'x-nexus-crm-webhook-check':'internal-read-only',
          'asaas-access-token':token,
          accept:'application/json',
        },
        signal:AbortSignal.timeout(6000),
      });
    if(response.status===401)return 'receiver_rejected_token';
    if(!response.ok || Number(response.headers.get('content-length')||0)>1000)
      return 'receiver_unavailable';
    const body=await response.text();
    if(body.length>1000)return 'receiver_invalid_response';
    const parsed=JSON.parse(body);
    return parsed?.status==='internal_token_and_inbox_ok'
      &&parsed?.paidEvent===false
      &&parsed?.providerDeliveryVerified===false
      &&parsed?.createdCharge===false
      &&parsed?.accessGranted===false
        ? 'internal_token_and_inbox_ok':'receiver_invalid_response';
  }catch{return 'receiver_unavailable';}
}

async function preClientReadiness(admin:any){
  const requiredFlags=[
    'NEXUS_CRM_ASAAS_PROD_RELEASE_APPROVED',
    'NEXUS_CRM_ASAAS_PROD_CHECKOUT_ENABLED',
    'NEXUS_CRM_ASAAS_PROD_SETTLEMENT_READY',
    'NEXUS_CRM_ASAAS_PROD_WEBHOOK_CONFIRMED',
    'NEXUS_CRM_ASAAS_PROD_EVENTS_ENABLED',
    'NEXUS_CRM_ASAAS_PROD_EVENTS_RECEIVE_ONLY_ENABLED',
    'NEXUS_CRM_ASAAS_PROD_VERIFY_ENABLED',
    'NEXUS_CRM_ASAAS_PROD_PROVISION_ENABLED',
    'NEXUS_CRM_ASAAS_PROD_RESERVATION_ENABLED',
    'NEXUS_CRM_ASAAS_PROD_CLAIM_ENABLED',
    'NEXUS_CRM_ASAAS_PROD_DISPATCH_ENABLED',
    'NEXUS_CRM_ASAAS_PROD_RENEWAL_ENABLED',
  ];
  const flagsPending=requiredFlags.filter(name=>Deno.env.get(name)!=='true');
  const requiredSecrets=[
    'NEXUS_CRM_ASAAS_PROD_EVENTS_TOKEN',
    'NEXUS_CRM_ASAAS_PROD_CHECKOUT_BRIDGE_SECRET',
    'NEXUS_CRM_ASAAS_PROD_WORKER_SECRET',
    'NEXUS_CRM_ASAAS_PROD_VERIFY_SECRET',
    'NEXUS_CRM_ASAAS_PROD_RENEWAL_SECRET',
  ];
  const seen=new Set<string>();
  const secretsPending:string[]=[];
  for(const name of requiredSecrets){
    const value=Deno.env.get(name)||'';
    if(value.length<32 || seen.has(value))secretsPending.push(name);
    if(value.length>=32)seen.add(value);
  }
  const asaasKey=Deno.env.get('ASAAS_PRODUCTION_API_KEY')||'';
  const validAsaasKey=asaasKey.startsWith('$aact_prod_')&&asaasKey.length>=32;
  if(!validAsaasKey || seen.has(asaasKey))secretsPending.push('ASAAS_PRODUCTION_API_KEY');
  const url=Deno.env.get('SUPABASE_URL')||'';
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  if(!url||service.length<30)secretsPending.push('SUPABASE_BACKEND');
  const {data:product,error:productError}=await admin.from('nexus_products')
    .select('id').eq('code','crm').eq('status','active').maybeSingle();
  let plansReady=false;
  if(!productError && product?.id){
    const {data:plans,error:planError}=await admin.from('nexus_plans')
      .select('code,status,public_visible,price_cents,billing_interval_months,currency')
      .eq('product_id',product.id).in('code',['start','pro','gestao']);
    plansReady=!planError && Array.isArray(plans) && plans.length===3
      &&new Set(plans.map((x:any)=>x.code)).size===3
      &&plans.every((x:any)=>x.status==='active' && x.public_visible===true
        && x.currency==='BRL' && x.billing_interval_months===1
        && Number.isSafeInteger(x.price_cents) && x.price_cents>0);
  }
  let webhookStatus='provider_not_checked';
  if(validAsaasKey){
    try{
      const response=await fetch('https://api.asaas.com/v3/webhooks?limit=100',{
        method:'GET',headers:{accept:'application/json',access_token:asaasKey,
          'User-Agent':'NexusCRM-ReadOnlyReadiness/1.0'},
        signal:AbortSignal.timeout(8000),
      });
      if(response.ok && Number(response.headers.get('content-length')||0)<=30000){
        const raw=await response.text();
        if(raw.length<=30000){
          const parsed=JSON.parse(raw);
          webhookStatus=assessCrmAsaasProductionWebhook(
            parsed?.data,
            'https://svphwbccqeoakpmcpvhy.supabase.co/functions/v1/nexus-crm-asaas-production-events',
            !secretsPending.includes('NEXUS_CRM_ASAAS_PROD_EVENTS_TOKEN'),
            Deno.env.get('NEXUS_CRM_ASAAS_PROD_EVENTS_ENABLED')==='true'
              &&Deno.env.get('NEXUS_CRM_ASAAS_PROD_EVENTS_RECEIVE_ONLY_ENABLED')==='true',
          ).status;
        }else webhookStatus='provider_response_too_large';
      }else webhookStatus='provider_lookup_unavailable';
    }catch{webhookStatus='provider_lookup_unavailable';}
  }else webhookStatus='provider_key_not_configured';
  const bridgeStatus=await crmAsaasBridgeProofStatus();
  const receiverProbeStatus=await checkInternalWebhookReceiver();
  return {
    status:'preflight',readOnly:true,createdCharge:false,accessGranted:false,
    providerDeliveryVerified:false, // only the FIRST genuine payment proves delivery
    flagsPending,secretsPending,plansReady,webhookStatus,bridgeStatus,receiverProbeStatus,
    readyToReceiveFirstCustomer:flagsPending.length===0 && secretsPending.length===0
      &&plansReady && webhookStatus==='receiver_ready_for_delivery_test'
      &&bridgeStatus==='matched' &&receiverProbeStatus==='internal_token_and_inbox_ok',
  };
}

Deno.serve(async(request:Request)=>{
  if(request.method!=='POST')return reply({error:'Método não permitido.'},405);
  // Authenticate BEFORE accepting even a read-only request. Never log JWTs.
  const sourceEvent=await authorizedGithubJob(request);
  if(!sourceEvent)return reply({error:'Não autorizado.'},401);
  const action=await readAction(request);
  if(!action)return reply({error:'Solicitação inválida.'},400);
  // Push exists only to prove production connectivity when deploying the
  // monitor workflow. Push events can NEVER start financial processing.
  if(sourceEvent==='push' && action!=='inspect' && action!=='readiness')
    return reply({error:'Somente diagnóstico permitido nesta execução.'},403);
  if(action==='dispatch'){
    if(PRODUCTION_FINANCIAL_DISPATCH_DISABLED
      ||Deno.env.get('NEXUS_CRM_ASAAS_PROD_DISPATCH_ENABLED')!=='true'
      ||Deno.env.get('NEXUS_CRM_ASAAS_PROD_SETTLEMENT_READY')!=='true'
      ||Deno.env.get('NEXUS_CRM_ASAAS_PROD_WEBHOOK_CONFIRMED')!=='true') {
      return reply({status:'financial_dispatch_hard_off',
        readOnly:true,createdCharge:false,accessGranted:false},503);
    }
  }
  const url=Deno.env.get('SUPABASE_URL')||'';
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  if(!url||service.length<30)return reply({error:'Serviço indisponível.'},503);
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  if(action==='readiness'){
    const details=await preClientReadiness(admin);
    return reply(details,200);
  }
  if(action==='inspect'){
    const counts=await backlog(admin);
    if(!counts)return reply({error:'Fila indisponível.'},503);
    return reply({status:'inspected',...counts,readOnly:true,
      financialDispatchEnabled:false,createdCharge:false,
      accessGranted:false,providerDeliveryVerified:false},200);
  }
  // This section cannot execute while PRODUCTION_FINANCIAL_DISPATCH_DISABLED
  // remains true. Even after release, each downstream worker has *its own*
  // code-level hard-off, opt-in secrets, live verification and DB leases.
  const {data:events,error}=await admin.from('nexus_crm_asaas_production_events')
    .select('provider_event_id,event_type,resource_id,payload,environment,processing_status')
    .eq('environment','production').eq('processing_status','pending')
    .order('received_at',{ascending:true}).limit(MAX_EVENTS);
  if(error)return reply({error:'Fila indisponível.'},503);
  const summary={status:'dispatch_attempt',inspected:0,completed:0,
    manualReview:0,retry:0,createdCharge:false};
  for(const event of (events||[]) as EventRow[]){
    summary.inspected++;
    let candidates:any[]=[];
    try{
      if(['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(event.event_type))
        candidates=await findSales(admin,event);
    }catch{summary.retry++;continue;}
    let productCode:string|null=null;
    if(candidates.length===1){
      const {data:product,error:pError}=await admin.from('nexus_products')
        .select('code').eq('id',candidates[0].product_id).maybeSingle();
      if(pError){summary.retry++;continue;}
      productCode=product?.code||null;
    }
    const plan=planCrmAsaasProductionDispatch({
      eventRow:event,sales:candidates,productCode:productCode||undefined,
    });
    if(plan.decision==='hold'){summary.retry++;continue;}
    if(plan.decision==='manual_review'){
      try{
        if(await markEvent(admin,event.provider_event_id,'manual_review',plan.reason))
          summary.manualReview++;
      }catch{summary.retry++;}
      continue;
    }
    if(plan.decision!=='route_for_independent_verification'
      ||!['provision','renewal','annual'].includes(plan.worker||'')){
      summary.retry++;continue;
    }
    const worked=await callIndependentWorker(url,plan.worker as 'provision'|'renewal'|'annual',
      event.provider_event_id);
    if(worked.decision==='processed'){
      try{
        // The renewal worker may already have atomically marked it processed.
        // On repeat runs the worker's receipt/RPC is independently idempotent.
        await markEvent(admin,event.provider_event_id,'processed',null);
        summary.completed++;
      }catch{summary.retry++;}
    } else if(worked.decision==='manual_review'){
      try{
        if(await markEvent(admin,event.provider_event_id,'manual_review','worker_requires_manual_review'))
          summary.manualReview++;
      }catch{summary.retry++;}
    }else summary.retry++;
  }
  return reply(summary,200);
});
