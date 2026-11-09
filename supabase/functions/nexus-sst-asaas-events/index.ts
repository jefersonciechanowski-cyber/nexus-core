import { createClient } from 'npm:@supabase/supabase-js@2.112.3';

// Asaas SST-only webhook inbox. This endpoint NEVER activates access or charges.
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{
 status,headers:{'content-type':'application/json','cache-control':'no-store'}
});
async function authenticToken(candidate:string,expected:string){
  if(expected.length<32||expected.length>255||candidate.length!==expected.length)return false;
  const encoder=new TextEncoder();
  const [a,b]=await Promise.all([
    crypto.subtle.digest('SHA-256',encoder.encode(candidate)),
    crypto.subtle.digest('SHA-256',encoder.encode(expected))
  ]);
  const x=new Uint8Array(a),y=new Uint8Array(b);
  let difference=0;for(let i=0;i<x.length;i++)difference|=x[i]^y[i];
  return difference===0;
}
function safeProviderId(x:unknown){
 const s=typeof x==='string'?x:'';
 return /^[A-Za-z0-9_&.-]{5,160}$/.test(s)?s:null;
}
async function limitedBody(req:Request){
 const headerLength=Number(req.headers.get('content-length')||0);
 if(headerLength>32768||!req.body)return null;
 const reader=req.body.getReader(),parts:Uint8Array[]=[];let count=0;
 try{
   while(true){const {done,value}=await reader.read();if(done)break;
     count+=value.byteLength;if(count>32768)return null;parts.push(value);
   }
 }finally{reader.releaseLock();}
 const bytes=new Uint8Array(count);let off=0;
 for(const p of parts){bytes.set(p,off);off+=p.byteLength;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return null;}
}
Deno.serve(async req=>{
 if(req.method!=='POST')return reply({error:'method_not_allowed'},405);
 // Webhook inbox activation is independent of financial checkout release.
 // Events are stored only; this handler cannot create charges or grant access.
 if(Deno.env.get('NEXUS_SST_ASAAS_PROD_WEBHOOK_ENABLED')!=='true')
   return reply({error:'sst_webhook_not_released'},503);
 const expected=Deno.env.get('NEXUS_SST_ASAAS_PROD_EVENTS_TOKEN')||'';
 const supplied=req.headers.get('asaas-access-token')||'';
 if(!await authenticToken(supplied,expected))return reply({error:'unauthorized'},401);
 if(!(req.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))
   return reply({error:'invalid_content_type'},415);
 const input=await limitedBody(req);
 if(!input||typeof input!=='object')return reply({error:'invalid_json'},400);
 const id=safeProviderId(input.id),event=typeof input.event==='string'?input.event:'';
 if(!id||!/^PAYMENT_[A-Z_]{3,55}$/.test(event))return reply({ignored:true});
 const paymentId=safeProviderId(input.payment?.id);
 if(!paymentId)return reply({error:'payment_id_missing'},400);
 const linkId=safeProviderId(input.payment?.paymentLink);
 const subscriptionId=safeProviderId(input.payment?.subscription);
 // A billing event may refer to an already active SST subscription, without paymentLink.
 if(!linkId&&!subscriptionId)return reply({ignored:true});
 const url=Deno.env.get('SUPABASE_URL')||'';
 const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 if(!url||key.length<32)return reply({error:'db_not_configured'},503);
 const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {error}=await admin.from('nexus_sst_asaas_payment_events').upsert({
   provider_event_id:id,event_type:event,provider_payment_id:paymentId,
   provider_link_id:linkId,provider_subscription_id:subscriptionId,
   processing_status:'pending'
 },{onConflict:'provider_event_id',ignoreDuplicates:true});
 if(error)return reply({error:'persist_failed'},503);
 return reply({received:true},200);
});
