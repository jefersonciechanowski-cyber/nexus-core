import {createClient} from 'npm:@supabase/supabase-js@2.112.3';
import {normalizeCrmInterest,CRM_INTEREST_PLANS} from '../_shared/crm-public-interest.mjs';

// Nexus CRM public advertising interest capture. This is NOT a checkout.
// Stores only contact details voluntarily supplied and authorizes no payment.
const PUBLIC_ORIGIN='https://nexuscore.app.br';
const MAX_BODY_BYTES=4096;
const cors={
  'access-control-allow-origin':PUBLIC_ORIGIN,
  'access-control-allow-methods':'POST, OPTIONS',
  'access-control-allow-headers':'content-type',
  'vary':'Origin',
  'cache-control':'no-store',
  'x-content-type-options':'nosniff',
};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{
  status,headers:{...cors,'content-type':'application/json; charset=utf-8'},
});
async function readLimited(request:Request) {
  const length=Number(request.headers.get('content-length')||0);
  if(!Number.isFinite(length)||length>MAX_BODY_BYTES||!request.body)return null;
  const reader=request.body.getReader();
  const chunks:Uint8Array[]=[];let size=0;
  try{
    while(true) {
      const chunk=await reader.read();if(chunk.done)break;
      size+=chunk.value?.length||0;
      if(size>MAX_BODY_BYTES)return null;
      if(chunk.value)chunks.push(chunk.value);
    }
    const buffer=new Uint8Array(size);let offset=0;
    for(const c of chunks){buffer.set(c,offset);offset+=c.length;}
    return new TextDecoder('utf-8',{fatal:true}).decode(buffer);
  }catch{return null;}
  finally{try{await reader.cancel();}catch{/* stream done */}}
}
async function fingerprint(secret:string,phone:string) {
  const buffer=new TextEncoder().encode('crm-public-interest-v1:'+secret+':'+phone);
  const digest=await crypto.subtle.digest('SHA-256',buffer);
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
}

Deno.serve(async(request:Request):Promise<Response>=>{
  const origin=request.headers.get('origin');
  if(origin!==PUBLIC_ORIGIN)return json({error:'Origem não autorizada.'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(request.method!=='POST')return json({error:'Método não permitido.'},405);
  if(!(request.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))
    return json({error:'Formato inválido.'},415);
  const raw=await readLimited(request);
  if(!raw)return json({error:'Solicitação inválida.'},400);
  let body:unknown;
  try{body=JSON.parse(raw);}catch{return json({error:'Dados inválidos.'},400);}
  const normalized=normalizeCrmInterest(body);
  if(normalized.spam)return json({received:true,noPayment:true},202);
  if(!normalized.payload)return json({error:normalized.error||'Dados inválidos.'},400);
  const lead=normalized.payload;
  const url=Deno.env.get('SUPABASE_URL')||'';
  const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  if(!url||service.length<30)return json({error:'Serviço de contato indisponível.'},503);
  const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  const hash=await fingerprint(service,lead.phone);
  const {data:allowed,error:rateError}=await admin.rpc('consume_nexus_public_request_limit',{
    p_fingerprint_hash:hash,p_action:'crm-public-interest',
    p_window_seconds:3600,p_limit:3,
  });
  if(rateError)return json({error:'Serviço temporariamente indisponível.'},503);
  if(allowed!==true)return json({error:'Limite de tentativas. Tente mais tarde.'},429);
  const {data:product,error:productError}=await admin.from('nexus_products')
    .select('id').eq('code','crm').eq('status','active').maybeSingle();
  if(productError||!product?.id)return json({error:'CRM indisponível.'},503);
  let selectedPlan:string|null=null;
  if(lead.planCode) {
    if(!CRM_INTEREST_PLANS.includes(lead.planCode))return json({error:'Plano inválido.'},400);
    const {data:plan,error:planError}=await admin.from('nexus_plans')
      .select('id').eq('product_id',product.id).eq('code',lead.planCode)
      .eq('status','active').maybeSingle();
    if(planError||!plan?.id)return json({error:'Plano temporariamente indisponível.'},503);
    selectedPlan=plan.id;
  }
  // Ignore repeated ad submissions for the same phone over 24 h. No returning
  // another customer's lead ID or contact data to an anonymous client.
  const since=new Date(Date.now()-24*60*60*1000).toISOString();
  const {data:recent,error:recentError}=await admin.from('nexus_sales')
    .select('id').eq('product_id',product.id).eq('phone',lead.phone)
    .eq('sale_status','lead').gte('created_at',since).limit(1);
  if(recentError)return json({error:'Não foi possível conferir o pedido.'},503);
  if(recent?.length)return json({received:true,noPayment:true},200);
  const tracking=[
    'Interesse pelo Nexus CRM; contratação assistida, sem pagamento.',
    'Autorizou contato e aceitou a Política de Privacidade.',
    lead.utmSource?'UTM origem: '+lead.utmSource:'',
    lead.utmMedium?'UTM meio: '+lead.utmMedium:'',
    lead.utmTerm?'UTM termo: '+lead.utmTerm:'',
  ].filter(Boolean).join(' ').slice(0,480);
  // Financial fields are NOT accepted from the browser. This record cannot
  // be mistaken for a paid Asaas event or provisioned account.
  const {error:saveError}=await admin.from('nexus_sales').insert({
    product_id:product.id,plan_id:selectedPlan,
    sale_status:'lead',lead_stage:'new',source:'site-captacao',
    company_name:lead.companyName,responsible_name:lead.responsibleName,
    email:lead.email||null,phone:lead.phone,
    provider:'asaas',environment:'production',
    billing_mode:'recurring',billing_cycle_months:1,
    return_origin:PUBLIC_ORIGIN,
    campaign_name:lead.utmCampaign||null,
    ad_name:lead.utmContent||null,
    lead_notes:tracking,
  });
  if(saveError)return json({error:'Não foi possível receber o contato. Tente novamente.'},503);
  return json({received:true,noPayment:true},201);
});
