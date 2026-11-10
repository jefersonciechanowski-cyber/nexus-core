import {createClient} from 'npm:@supabase/supabase-js@2.112.3';
import {trustedAsaasToken} from '../_shared/crm-asaas-events.mjs';
import {verifyTrialUpgradePayment} from '../_shared/crm-trial-upgrade.mjs';
import {syncCrmEntitlement} from '../stripe-webhook/crm-provisioning.ts';
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
Deno.serve(async(req:Request)=>{
 if(Deno.env.get('NEXUS_CRM_TRIAL_PAID_UPGRADE_READY')!=='true'||Deno.env.get('NEXUS_CRM_ASAAS_PROD_RELEASE_APPROVED')!=='true'||Deno.env.get('NEXUS_CRM_ASAAS_PROD_WEBHOOK_CONFIRMED')!=='true')return reply({decision:'retry'},503);
 if(req.method!=='POST')return reply({error:'Método inválido.'},405);
 const key=Deno.env.get('NEXUS_CRM_ASAAS_PROD_WORKER_SECRET')||'';
 const apiKey=Deno.env.get('ASAAS_PRODUCTION_API_KEY')||'';
 if(key===apiKey||key===Deno.env.get('NEXUS_CRM_ASAAS_PROD_EVENTS_TOKEN')||!trustedAsaasToken(req.headers.get('x-nexus-crm-upgrade-key'),key))return reply({error:'Não autorizado.'},401);
 if(!apiKey.startsWith('$aact_prod_'))return reply({decision:'retry'},503);
 const raw=await req.text();let eventId;try{eventId=JSON.parse(raw).eventId;}catch{return reply({error:'Pedido inválido.'},400);}
 if(raw.length>2048||typeof eventId!=='string'||!/^asaas:evt_[A-Za-z0-9_&.-]{6,150}$/.test(eventId))return reply({error:'Evento inválido.'},400);
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false}});
 const {data:event,error:ee}=await admin.from('nexus_crm_asaas_production_events').select('*').eq('provider_event_id',eventId).eq('processing_status','pending').single();
 if(ee)return reply({decision:'retry'},503);
 const {data:sale,error:se}=await admin.from('nexus_sales').select('*').eq('asaas_checkout_id',event.payload?.resource?.paymentLink).eq('source','crm-trial-upgrade').eq('environment','production').single();
 if(se)return reply({decision:'manual_review'},409);
 const {data:plan,error:pe}=await admin.from('nexus_plans').select('*').eq('id',sale.plan_id).single();
 if(pe)return reply({decision:'retry'},503);
 const verified=await verifyTrialUpgradePayment({event:{...event,provider:'asaas'},sale,plan,fetchResource:async(path:string)=>{
  if(!/^\/(payments|paymentLinks|subscriptions|customers)\/[A-Za-z0-9_-]{4,130}$/.test(path))throw Error('invalid_provider_path');
  const response=await fetch('https://api.asaas.com/v3'+path,{headers:{access_token:apiKey,'User-Agent':'NexusCRM-TrialUpgradeVerification/1.0'},signal:AbortSignal.timeout(9000)});
  if(!response.ok)throw Error('provider_unavailable');const text=await response.text();if(text.length>30000)throw Error('excessive_response');return JSON.parse(text);
 }});
 if(verified.decision!=='verified')return reply(verified,verified.decision==='retry'?503:409);
 const v=verified as {paymentId:string;subscriptionId:string;customerId:string;amountCents:number;billingType:string;dueDate:string;nextDueDate:string};
 const {data:staged,error}=await admin.rpc('stage_nexus_crm_trial_upgrade',{p_sale_id:sale.id,p_event_id:eventId,p_payment_id:v.paymentId,p_subscription_id:v.subscriptionId,p_customer_id:v.customerId,p_amount_cents:v.amountCents,p_billing_type:v.billingType,p_due_date:v.dueDate,p_next_due_date:v.nextDueDate});
 if(error||!staged?.accessId)return reply({decision:'retry',reason:'upgrade_stage_unavailable'},503);
 if(staged.decision!=='completed'){
  const sync=await syncCrmEntitlement(admin,staged.accessId,'active',new Date().toISOString(),true);
  if(!sync.isCrm||!sync.synced||sync.error)return reply({decision:'retry',reason:'crm_activation_pending'},503);
 }
 const {data:confirmed,error:ce}=await admin.rpc('confirm_nexus_crm_trial_upgrade',{p_sale_id:sale.id,p_payment_id:v.paymentId});
 if(ce||confirmed?.decision!=='provisioned')return reply({decision:'retry',reason:'crm_confirmation_pending'},503);
 return reply({decision:'provisioned',crmSynced:true});
});
