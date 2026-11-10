import {createClient} from 'npm:@supabase/supabase-js@2.112.3';
import {createRemoteJWKSet,jwtVerify} from 'npm:jose@6.1.0';
import {verifySstAsaasPaymentProof} from '../_shared/sst-asaas-payment-proof.mjs';

// Finance worker. Scheduled from the specifically authorized GitHub workflow.
// Never creates payment links, customers, subscriptions or charges.
const REPO='jefersonciechanowski-cyber/nexus-core';
const WF=REPO+'/.github/workflows/sst-asaas-reconcile.yml@refs/heads/main';
const AUDIENCE='nexus-sst-asaas-reconcile';
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{'content-type':'application/json','cache-control':'no-store'}
});
const clean=(v:unknown,max=255)=>String(v??'').trim().slice(0,max);
const validId=(v:unknown)=>typeof v==='string' && /^[A-Za-z0-9_&.-]{5,160}$/.test(v);
async function authenticate(req:Request){
 const token=clean(req.headers.get('authorization'),8000).replace(/^Bearer\s+/i,'');
 if(!token)return false;
 try{
  const jwks=createRemoteJWKSet(new URL('https://token.actions.githubusercontent.com/.well-known/jwks'));
  const {payload}=await jwtVerify(token,jwks,{issuer:'https://token.actions.githubusercontent.com',audience:AUDIENCE});
  return payload.repository===REPO && payload.ref==='refs/heads/main'
    && payload.workflow_ref===WF
    && ['schedule','workflow_dispatch','push'].includes(String(payload.event_name||''));
 }catch{return false;}
}
async function asaasGet(key:string,path:string){
 if(!/^\/(?:payments|paymentLinks|subscriptions|customers)\/[A-Za-z0-9_-]{5,130}(?:\/payments\?limit=100)?$/.test(path))
   throw Error('unsafe_provider_path');
 const res=await fetch('https://api.asaas.com/v3'+path,{
   headers:{'accept':'application/json','access_token':key,'User-Agent':'NexusSST-VerifiedSettlement/1.0'},
   signal:AbortSignal.timeout(9000)
 });
 if(!res.ok)throw Error('provider_query_unavailable');
 const body=await res.text();
 if(body.length>30000)throw Error('provider_response_oversized');
 return JSON.parse(body);
}
async function processEvent(admin:any,key:string,event:any){
 const mark=async(processing_status:string,error_code:string|null=null)=>{
   await admin.from('nexus_sst_asaas_payment_events').update({
     processing_status,error_code,processed_at:new Date().toISOString()
   }).eq('provider_event_id',event.provider_event_id).eq('processing_status','pending');
 };
 // Other events are not proof of payment and MUST NOT activate an account.
 if(!['PAYMENT_CONFIRMED','PAYMENT_RECEIVED'].includes(event.event_type)){
   await mark('ignored','not_paid_event');
   return 'ignored';
 }
 // Trust only an independently fetched payment, never the webhook's
 // optional paymentLink/subscription fields. Some genuine Asaas events carry
 // only payment.id, and they must still be classified correctly.
 const payment=await asaasGet(key,'/payments/'+event.provider_payment_id);
 if(payment?.id!==event.provider_payment_id){
   await mark('review','provider_payment_mismatch');return 'review';
 }
 const providerLink=validId(payment.paymentLink)?payment.paymentLink:null;
 const providerSubscription=validId(payment.subscription)?payment.subscription:null;
 let query=admin.from('nexus_sst_asaas_pilot_checkouts').select('*');
 if(providerLink)query=query.eq('provider_link_id',providerLink);
 else if(providerSubscription)query=query.eq('provider_subscription_id',providerSubscription);
 else{await mark('ignored','no_verified_billing_reference');return 'ignored';}
 const {data:intent,error:intentError}=await query.limit(2);
 if(intentError)throw Error('intent_lookup_unavailable');
 if(!intent?.length){await mark('ignored','not_sst_checkout');return 'ignored';}
 if(intent.length!==1||!['ready','paid'].includes(intent[0].state)){
   await mark('review','checkout_not_eligible');return 'review';
 }
 const checkout=intent[0];
 if(checkout.environment!=='production'||!validId(checkout.provider_link_id)){
   await mark('review','provider_reference_invalid');return 'review';
 }
 if(!['CONFIRMED','RECEIVED'].includes(payment.status)){
   // Webhook could arrive before Asaas' GET reflects settlement.
   return 'retry';
 }
 const subId=payment.subscription,customerId=payment.customer;
 if(!validId(subId)||!validId(customerId)){
   await mark('review','payment_reference_invalid');return 'review';
 }
 const [link,subscription,customer]=await Promise.all([
   asaasGet(key,'/paymentLinks/'+checkout.provider_link_id),
   asaasGet(key,'/subscriptions/'+subId),
   asaasGet(key,'/customers/'+customerId)
 ]);
 const proof=verifySstAsaasPaymentProof({
   checkout,payment,link,subscription,customer,
   todayISO:new Date().toISOString().slice(0,10)
 });
 if(!proof.ok){
   await mark('review','reason' in proof ? proof.reason : 'unverified_payment');return 'review';
 }
 const nextDate='nextDueDate' in proof ? proof.nextDueDate : null;
 if(!nextDate){await mark('review','missing_next_due_date');return 'review';}
 const {data:result,error:recordError}=await admin.rpc('record_verified_nexus_sst_asaas_payment',{
   p_checkout_id:checkout.id,p_event_id:event.provider_event_id,
   p_payment_id:payment.id,p_customer_id:customerId,p_subscription_id:subId,
   p_next_due_date:nextDate,p_payment_status:payment.status
 });
 if(recordError){
   console.error('sst-asaas-record-verification',clean(recordError.code,24));
   await mark('review','atomic_settlement_failed');return 'review';
 }
 if(result?.applied===true || result?.reason==='payment_already_verified'){
   await mark('processed');return 'processed';
 }
 await mark('review','unexpected_settlement_result');return 'review';
}

async function reconcileOverdueSst(admin:any,asaasKey:string){
 const GRACE_DAYS=7; // SST monthly grace; provider proof is required for suspension.
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',
   year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const {data:checkouts,error}=await admin.from('nexus_sst_asaas_pilot_checkouts')
   .select('id,access_id,provider_subscription_id,provider_customer_id,amount_cents')
   .eq('state','paid').eq('environment','production')
   .order('created_at',{ascending:true}).limit(100);
 if(error)throw Error('paid_checkouts_unavailable');
 const result={checked:0,suspended:0,review:0,retry:0};
 for(const checkout of checkouts||[]){
   const {data:access,error:accessError}=await admin.from('organization_product_access')
     .select('id,renews_at,access_status,subscription_status,billing_provider')
     .eq('id',checkout.access_id).maybeSingle();
   if(accessError){result.retry++;continue;}
   if(!access || access.access_status!=='active' || access.subscription_status!=='active'
     || access.billing_provider!=='asaas' || !access.renews_at)continue;
   const lateBy=Math.floor((Date.parse(today+'T12:00:00Z')-Date.parse(access.renews_at+'T12:00:00Z'))/86400000);
   if(!Number.isFinite(lateBy)||lateBy<=GRACE_DAYS)continue;
   if(!validId(checkout.provider_subscription_id)||!validId(checkout.provider_customer_id)){
     result.review++;continue;
   }
   result.checked++;
   if(result.checked>3)break;
   try{
     const subscription=await asaasGet(asaasKey,'/subscriptions/'+checkout.provider_subscription_id);
     if(subscription?.id!==checkout.provider_subscription_id
       ||subscription.customer!==checkout.provider_customer_id
       ||subscription.cycle!=='MONTHLY'
       ||!Number.isFinite(Number(subscription.value))
       ||Math.round(Number(subscription.value)*100)!==Number(checkout.amount_cents)){
       result.review++;continue;
     }
     const invoices=await asaasGet(asaasKey,
       '/subscriptions/'+checkout.provider_subscription_id+'/payments?limit=100');
     if(!Array.isArray(invoices?.data)||invoices.hasMore===true){
       result.review++;continue;
     }
     const relevant=invoices.data.filter((p:any)=>
       p?.subscription===checkout.provider_subscription_id
       && p?.customer===checkout.provider_customer_id
       && Number.isFinite(Number(p?.value))
       && Math.round(Number(p.value)*100)===Number(checkout.amount_cents)
       && typeof p?.dueDate==='string'&&p.dueDate>=access.renews_at
       && p.dueDate<=today);
     if(relevant.some((p:any)=>['CONFIRMED','RECEIVED'].includes(p.status))){
       // Never suspend if Asaas has a recent paid invoice; investigate missed webhook.
       result.review++;continue;
     }
     if(!relevant.some((p:any)=>p.status==='OVERDUE')){
       // No authoritative overdue invoice: stay active, require investigation.
       result.review++;continue;
     }
     const {data:state,error:rpcError}=await admin.rpc('suspend_verified_nexus_sst_asaas_overdue',{
       p_checkout_id:checkout.id,p_expected_renews_at:access.renews_at,p_grace_days:GRACE_DAYS
     });
     if(rpcError){result.retry++;continue;}
     if(state?.applied===true)result.suspended++;
   }catch(e){
     console.error('sst-asaas-overdue-provider-unavailable',clean((e as Error)?.message,80));
     result.retry++;
   }
 }
 return result;
}

Deno.serve(async req=>{
 if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
 if(!await authenticate(req))return reply({error:'unauthorized'},401);
 const url=Deno.env.get('SUPABASE_URL')||'';
 const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 if(!url||secret.length<32)return reply({error:'db_unavailable'},503);
 const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:release,error:releaseError}=await admin.from('nexus_sst_asaas_release_controls')
   .select('checkout_enabled,reconciliation_enabled,asaas_connection_verified_at,webhook_secret_present_at,worker_heartbeat_at')
   .eq('id','production').maybeSingle();
 if(releaseError||!release)return reply({error:'release_controls_unavailable'},503);
 const {count:pending,error:countError}=await admin.from('nexus_sst_asaas_payment_events')
   .select('provider_event_id',{count:'exact',head:true}).eq('processing_status','pending');
 if(countError)return reply({error:'inbox_unavailable'},503);
 let input:Record<string,unknown>={};
 try{input=await req.json();}catch{return reply({error:'invalid_request'},400);}
 const key=Deno.env.get('ASAAS_PRODUCTION_API_KEY')||'';
 const keyConfigured=key.startsWith('$aact_prod_')&&key.length>=32;
 const token=Deno.env.get('NEXUS_SST_ASAAS_PROD_EVENTS_TOKEN')||'';
 const webhookConfigured=token.length>=32
   &&Deno.env.get('NEXUS_SST_ASAAS_PROD_WEBHOOK_ENABLED')==='true';
 if(input.action==='inspect'){
   let providerVerified=false;
   if(keyConfigured){
     try{
       const response=await fetch('https://api.asaas.com/v3/paymentLinks?limit=1',{
         method:'GET',headers:{'accept':'application/json','access_token':key,
           'User-Agent':'NexusSST-ReadOnly-Health/1.0'},
         signal:AbortSignal.timeout(10000)
       });
       providerVerified=response.status===200;
       await response.body?.cancel();
     }catch{providerVerified=false;}
   }
   // Store only timestamps and booleans inferred from read-only API health;
   // never persist or disclose payment-link data, credentials or bearer tokens.
   const now=new Date().toISOString();
   const changes:Record<string,unknown>={worker_heartbeat_at:now,updated_at:now};
   if(providerVerified)changes.asaas_connection_verified_at=now;
   if(webhookConfigured)changes.webhook_secret_present_at=now;
   const {error:healthError}=await admin.from('nexus_sst_asaas_release_controls')
     .update(changes).eq('id','production');
   if(healthError)return reply({error:'health_not_saved'},503);
   return reply({status:'inspected',readOnly:true,createdCharge:false,accessGranted:false,
     pending:pending||0,providerVerified,webhookConfigured,
     checkoutEnabled:release.checkout_enabled,
     reconciliationEnabled:release.reconciliation_enabled});
 }
 if(input.action!=='dispatch')return reply({error:'invalid_action'},400);
 // A free-trial expiration cannot depend on the Asaas API being healthy.
 // This service-role RPC only suspends expired trials and never deletes records.
 const {data:expired,error:expiryError}=await admin.rpc('suspend_expired_nexus_sst_trials');
 if(expiryError)return reply({error:'sst_trial_expiry_failed'},503);
 const expiredTrials=Number(expired?.suspended||0);
 if(!release.reconciliation_enabled){
   return reply({status:'disabled',readOnly:true,createdCharge:false,
     accessGranted:false,expiredTrials});
 }
 const hoursSince=(value:unknown)=>typeof value==='string'&&Number.isFinite(Date.parse(value))
   ?(Date.now()-Date.parse(value))/3600000:Infinity;
 if(!keyConfigured||!webhookConfigured
   ||hoursSince(release.asaas_connection_verified_at)>=24
   ||hoursSince(release.worker_heartbeat_at)>=24
   ||hoursSince(release.webhook_secret_present_at)>=24)
   return reply({error:'verified_financial_connection_unavailable'},503);
 const {data:events,error}=await admin.from('nexus_sst_asaas_payment_events')
   .select('*').eq('processing_status','pending').order('created_at',{ascending:true}).limit(5);
 if(error)return reply({error:'events_unavailable'},503);
 const summary={status:'dispatched',inspected:0,processed:0,review:0,ignored:0,retry:0,createdCharge:false};
 for(const event of events||[]){
   summary.inspected++;
   try{
     const status=await processEvent(admin,key,event);
     if(status==='processed')summary.processed++;
     else if(status==='review')summary.review++;
     else if(status==='ignored')summary.ignored++;
     else summary.retry++;
   }catch(e){
     console.error('sst-asaas-reconcile-retry',clean((e as Error)?.message,80));
     summary.retry++;
   }
 }
 try{
   const overdue=await reconcileOverdueSst(admin,key);
   Object.assign(summary,{overdueChecked:overdue.checked,
     overdueSuspended:overdue.suspended,overdueReview:overdue.review,
     overdueRetry:overdue.retry});
 }catch(e){
   console.error('sst-asaas-overdue-check-failed',clean((e as Error)?.message,80));
   Object.assign(summary,{overdueChecked:0,overdueSuspended:0,overdueReview:0,overdueRetry:1});
 }
 return reply(summary);
});
