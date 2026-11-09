import {createClient} from 'npm:@supabase/supabase-js@2.112.3';
import {createRemoteJWKSet,jwtVerify} from 'npm:jose@6.1.0';

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
    && ['schedule','workflow_dispatch'].includes(String(payload.event_name||''));
 }catch{return false;}
}
async function asaasGet(key:string,path:string){
 if(!/^\/(payments|paymentLinks|subscriptions|customers)\/[A-Za-z0-9_-]{5,130}$/.test(path))
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
const matchesMoney=(value:unknown,cents:unknown)=>{
 const amount=Number(value),target=Number(cents);
 return Number.isFinite(amount)&&Number.isSafeInteger(target)&&Math.round(amount*100)===target;
};
const doc=(v:unknown)=>clean(v,40).replace(/\D/g,'');
function dateInFuture(v:unknown){
 const date=clean(v,20);
 if(!/^\d{4}-\d\d-\d\d$/.test(date))return null;
 const d=new Date(date+'T12:00:00Z');
 return Number.isFinite(d.getTime())&&d.toISOString().startsWith(date)
  && date>=new Date().toISOString().slice(0,10)?date:null;
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
 let query=admin.from('nexus_sst_asaas_pilot_checkouts').select('*');
 if(event.provider_link_id)query=query.eq('provider_link_id',event.provider_link_id);
 else if(event.provider_subscription_id)query=query.eq('provider_subscription_id',event.provider_subscription_id);
 else{await mark('ignored','no_billing_reference');return 'ignored';}
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
 const payment=await asaasGet(key,'/payments/'+event.provider_payment_id);
 if(payment?.id!==event.provider_payment_id){
   await mark('review','provider_payment_mismatch');return 'review';
 }
 if(!['CONFIRMED','RECEIVED'].includes(payment.status)){
   // Some webhooks arrive ahead of provider consistency. Let next run retry.
   return 'retry';
 }
 const subId=payment.subscription,customerId=payment.customer;
 if(!validId(subId)||!validId(customerId)||!matchesMoney(payment.value,checkout.amount_cents)
   ||payment.billingType!==checkout.billing_type){
   await mark('review','payment_identity_mismatch');return 'review';
 }
 if(checkout.state==='ready' && payment.paymentLink!==checkout.provider_link_id){
   await mark('review','payment_link_mismatch');return 'review';
 }
 if(checkout.state==='paid' && checkout.provider_subscription_id!==subId){
   await mark('review','subscription_not_bound');return 'review';
 }

 const [link,subscription,customer]=await Promise.all([
   asaasGet(key,'/paymentLinks/'+checkout.provider_link_id),
   asaasGet(key,'/subscriptions/'+subId),
   asaasGet(key,'/customers/'+customerId)
 ]);
 if(link?.id!==checkout.provider_link_id
   ||link.externalReference!=='sst-pilot-'+checkout.id
   ||link.chargeType!=='RECURRENT'||link.subscriptionCycle!=='MONTHLY'
   ||link.billingType!==checkout.billing_type
   ||!matchesMoney(link.value,checkout.amount_cents)
   ||subscription?.id!==subId||subscription.status!=='ACTIVE'
   ||subscription.cycle!=='MONTHLY'
   ||subscription.customer!==customerId
   ||!matchesMoney(subscription.value,checkout.amount_cents)
   ||customer?.id!==customerId||doc(customer.cpfCnpj)!==checkout.registration_number
   ||clean(customer.email,255).toLowerCase()!==checkout.owner_email.toLowerCase()
 ){
   await mark('review','financial_proof_mismatch');return 'review';
 }
 const nextDate=dateInFuture(subscription.nextDueDate);
 if(!nextDate){await mark('review','billing_period_unconfirmed');return 'review';}
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
Deno.serve(async req=>{
 if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
 if(!await authenticate(req))return reply({error:'unauthorized'},401);
 const url=Deno.env.get('SUPABASE_URL')||'';
 const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 if(!url||secret.length<32)return reply({error:'db_unavailable'},503);
 const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 const release=Deno.env.get('NEXUS_SST_ASAAS_PROD_RELEASE_APPROVED')==='true';
 const worker=Deno.env.get('NEXUS_SST_ASAAS_PROD_RECONCILE_ENABLED')==='true';
 const verified=Deno.env.get('NEXUS_SST_ASAAS_PROD_SETTLEMENT_READY')==='true';
 const {count:pending,error:countError}=await admin.from('nexus_sst_asaas_payment_events')
   .select('provider_event_id',{count:'exact',head:true}).eq('processing_status','pending');
 if(countError)return reply({error:'inbox_unavailable'},503);
 let input:Record<string,unknown>={};
 try{input=await req.json();}catch{return reply({error:'invalid_request'},400);}
 if(input.action==='inspect')return reply({
   status:'inspected',readOnly:true,createdCharge:false,accessGranted:false,
   pending:pending||0,readyForFinancialDispatch:release&&worker&&verified
 });
 if(input.action!=='dispatch')return reply({error:'invalid_action'},400);
 if(!release||!worker||!verified)return reply({error:'financial_dispatch_not_approved'},503);
 const key=Deno.env.get('ASAAS_PRODUCTION_API_KEY')||'';
 if(!key.startsWith('$aact_prod_')||key.length<32)return reply({error:'provider_not_configured'},503);
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
 return reply(summary);
});
